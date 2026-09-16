---
layout: post
title: AI 沙箱存算分离方案
---

给 Agent 配沙箱现在基本是标配：代码改在隔离环境里，跑完再看结果。workspace 得跟着会话活下去，计算节点却随时可以扔。开放注册量也估不准，存储还得能扩、能换。下面把讨论下来的做法写一下，方便对选型和 API。

<!-- more -->

## 背景

沙箱是短命的。进去有个工作目录，Agent 读写文件、跑命令，会话结束沙箱就拆掉。用户又希望下次还能接着干——仓库、草稿、中间产物都还在。

计算这边：沙箱开得快、关得干脆，坏了重建即可。存储这边：workspace 要长期活着，还能换盘、换机、换容量。别把文件堆在沙箱本地盘上，沙箱一毁数据就没了。

按用户预分配一块「永远在线」的重资源也不合适。开放注册扛不住——不知道明天涌进来多少人，也不能假设每个人都会持续占很大空间。存算分开，存储做成可扩可换的，别按峰值用户数去堆独占资源。

## 为何走挂载，而不是同步拉取回写

另一种常见做法：开机把文件拉进来，关机再写回去。听起来简单，开放注册场景里挺别扭。

workspace 可大可小。有人几个配置文件，有人半个仓库加构建缓存。全量拉取的话，会话启动会被文件体量绑架；回写还要处理冲突、部分失败、中途杀掉。量上来之后，这块同步窗口会变成控制面很难讲清楚的故障面。

我们倾向挂载。目录一直在存储层，沙箱只是临时看见它。Agent 读写的就是那份真实数据，按需发生，没有「先拷一份再当正式版」。沙箱挂了，目录还在；新沙箱再挂上去，就是恢复。

对象存储放在挂载下面，是为了把「盘」从计算节点上拆走。容量跟着桶走，节点坏了换一台再挂。哪天不想自建了，换成别的 S3 兼容后端也行，计算侧不用跟着翻盘。

## 选型

挂载层、对象存储、沙箱怎么看见这块盘，分开选。

挂载层用 JuiceFS，元数据放 Redis，数据放对象存储。Agent 和用户面对的还是普通目录，不是对象 key。节点上挂一次，上面的目录树按用户 / workspace 往下切就行。

对象存储用自建 MinIO，走 S3 兼容。一期不绑某家公有云，桶在自己这边。JuiceFS 认的是 S3，以后后端换成别的兼容实现，挂载协议不用换。

沙箱用腾讯 CubeSandbox，挂载方式选 Host Mount。JuiceFS 挂在宿主机节点上，再 bind 进 MicroVM；沙箱里面**不自己去挂 JuiceFS**。这样沙箱进程看不见 Redis、看不见 MinIO 密钥，也少一截「每个虚拟机各自挂文件系统」的复杂度。宿主机把目录准备好，沙箱只消费一个普通目录。

一期先做节点单挂载：一台机器挂好 JuiceFS，控制面可以跟沙箱跑在同一台机上（不同进程）。先把会话模型跑通。二期再上 Volume Plugin、多节点，挂载才能在集群里调度。那不是一期要一次做完的事。

## 拓扑与信任边界

控制面和沙箱必须分开，哪怕暂时挤在同一台机器上。同机只是起步，不是把密钥和用户代码塞进同一个进程。

```
  Agent（必存 workspace_id；snapshot_id 可选）
           |
           |  HTTPS + Bearer
           v
     +-----------+          同机不同进程即可起步
     |  控制面   |          Redis / MinIO 密钥停在这里
     +-----------+
           |
           |  建目录 / 开停沙箱 / 快照 / Host Mount
           v
     +-------------------+
     |  CubeSandbox      |
     |  MicroVM          |
     |    /workspace <---+-- bind --+
     +-------------------+          |
                                    |
     节点 JuiceFS 挂载              |
     /data/shared/jfs/...  <--------+
              |
              +--> Redis（JuiceFS Meta）
              +--> MinIO（S3 数据）
```

讨论下来有几件事先不做：

密钥不进沙箱。Redis、MinIO、JuiceFS 的访问凭证留在控制面和宿主机。沙箱里的 Agent 就算被提示词带跑，也拿不到存储后端。

不做每用户 Redis ACL。开放注册量不可控，给每个用户维护一套元数据 ACL，运营成本和出错面都很大。隔离靠路径约定和挂载白名单，不靠「每人一把 Redis 钥匙」。

hostPath 必须落在 `/data/shared/` 白名单下。控制面再怎么拼路径，最终绑进 MicroVM 的宿主机路径都不能逃出这块前缀，免得把节点上别的目录挂进去。

控制面管鉴权、拼路径、建目录、向 CubeSandbox 下发 Host Mount 和快照、记录 sandbox 与 workspace 的对应关系。沙箱就在 `/workspace` 里干活。

## 路径与会话模型

盘上真实路径是分层的，沙箱里只暴露一个工作根目录：

```
宿主机: /data/shared/jfs/{user_id}/{workspace_id}
沙箱内: /workspace
```

`/data/shared/` 是 JuiceFS 在节点上的挂载前缀，也是 hostPath 白名单。再往下用用户、workspace 切开，目录即隔离单元。初期租户通常就一个，目录不必再套 tenant。Agent 不要去记沙箱 ID，也不要去拼宿主机路径——那些是控制面的事。

两条平行线，别搅在一块：

- **`workspace_id`**：JuiceFS 上的文件，Host Mount 进沙箱。Agent 必存。
- **`snapshot_id`**：AI 运行时环境（会话里装的软件之类），Cube 快照。可选，AI 可以不用。

三个动作：

**创建。** 控制面**新生成**一个 `workspace_id`（UUID），再按 `/data/shared/jfs/{user_id}/{workspace_id}` mkdir，拉起沙箱，Host Mount 到 `/workspace`。返回 `workspace_id`、`sandbox_id`、`mount_path`、`status`。创建不打快照，响应里也不强塞 `snapshot_id`。创建不做「目录有了就复用」——那是 restore 的事。

**恢复。** 有 `snapshot_id` 就够了，请求不必再传 `workspace_id`：FromSnap 把环境拉回来，Host Mount 用快照里记下的配置挂回原来那条路径。控制面靠 DELETE 结束时的记账，校验这张快照是不是你的；响应里照样把解析出来的 `workspace_id` 给你。没 `snapshot_id` 就必须带 `workspace_id`：先校验这个 workspace 是否属于当前用户，再 ensure 目录还在（被误删就重建空目录，别悄悄挂到别人的路径上），普通冷启动再挂上去，**文件不丢**。两个都传也行，以 snapshot 为准，并核对是不是这个 workspace 的（对不上 409）。两个都不传，400。不是唤醒旧虚拟机，是短命计算重新贴上长寿目录。

**结束。** 沙箱还在的话，先 `create_snapshot`，按 `workspace_id` 只留最新一张、更早的删掉，再销毁沙箱。目录不动；`/data/shared/jfs/.../workspace_id` 继续留着。快照打失败也照关会话，`snapshot_id` 可以是 null。AI 可以记下这次的 `snapshot_id`，下次 restore 只带它就能暖恢复；不存也行，下次只靠 `workspace_id` 冷恢复。

目录长寿，沙箱短寿。`workspace_id` 是文件侧的稳定句柄；`snapshot_id` 是环境侧的可选项；`sandbox_id` 只覆盖这一次运行。

## API

对 Agent 只暴露会话，不暴露挂载细节。这些 JSON 接口 Bearer 就能调；控制面从身份里解析用户，路径里的 `{user_id}` 不让调用方随便填。浏览器预览、下载走 Cookie，后面单独说。

创建请求不传、也不认 body 里的 `workspace_id`。用户只从鉴权里取，不从 body 里填；要用已经存在的目录，走 restore。创建不打快照。

**POST /v1/sessions（创建）**

请求可以没有 body，或者给一个空 JSON `{}`——里面不要出现 `workspace_id`。控制面自己生成 UUID、建目录、再开沙箱。返回 `workspace_id`、`sandbox_id`、`mount_path`、`status`，不要强制 `snapshot_id`。

```http
POST /v1/sessions
Authorization: Bearer <token>
Content-Type: application/json

{}
```

```json
{
  "workspace_id": "7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34",
  "sandbox_id": "sb_91c2",
  "mount_path": "/workspace",
  "status": "running"
}
```

**POST /v1/sessions/restore**

有 `snapshot_id` 就走暖恢复，body 里不必再塞 `workspace_id`。FromSnap 之后，用快照里的 Host Mount 配置挂回原路径；归属靠 DELETE 时记下的 snapshot 记账来校验。响应仍返回解析出的 `workspace_id`。没 `snapshot_id` 就必须传 `workspace_id`，冷启动再挂目录。两个都传可以，以 snapshot 为准，并校验属于该 workspace（不一致 409）。两个都不传，400。

只传 `snapshot_id` 的暖恢复：

```http
POST /v1/sessions/restore
Authorization: Bearer <token>
Content-Type: application/json

{
  "snapshot_id": "snap_3f1c"
}
```

只传 `workspace_id` 的冷恢复：

```json
{
  "workspace_id": "7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34"
}
```

响应是新沙箱，不强塞 `snapshot_id`，但会带回解析出的 `workspace_id`：

```json
{
  "workspace_id": "7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34",
  "sandbox_id": "sb_a04e",
  "mount_path": "/workspace",
  "status": "running"
}
```

**DELETE /v1/sessions/{sandbox_id}**

只要鉴权，没有 body。URL 里是本次 sandbox。沙箱还在：`create_snapshot` → 按 `workspace_id` 只留最新快照、删更早的 → 再销毁沙箱。目录不删。成功是 **200**，带 `workspace_id`、`sandbox_id`、`snapshot_id`、`status`（比如 `stopped`）。

AI 可选存 `snapshot_id`；下次 restore 带上就能暖恢复，不必再传 `workspace_id`。不存也行，下次只靠 `workspace_id` 冷恢复。快照失败会话仍关，`snapshot_id` 可为 null。

```http
DELETE /v1/sessions/sb_a04e
Authorization: Bearer <token>
```

```json
{
  "workspace_id": "7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34",
  "sandbox_id": "sb_a04e",
  "snapshot_id": "snap_3f1c",
  "status": "stopped"
}
```

restore 不收旧的 `sandbox_id`。旧沙箱可能已经没了；文件认 `workspace_id`，环境认可选的 `snapshot_id`。

## Files 面

Files 管目录，不必先开沙箱。先看这个空间占了多大、里面有哪些文件、下载一份、打包一个目录带走、预览一段视频（拖进度那种）、iframe 里看 PDF、给文件改个名——这些都不该绑在「沙箱必须在跑」。

Sessions 管算力：开、恢复、关（结束时给运行时打一张 Cube 快照，AI 爱存不存）。Files 管目录：列表、读内容、打包下载、改名。两边共用同一条路径 `/data/shared/jfs/{user_id}/{workspace_id}`。没开沙箱，控制面照样打这条 JuiceFS 挂载路径。

## Files API

控制面直接打挂载上的目录，不经过沙箱。`path` 都相对 workspace 根，带 `..` 的直接拒。沙箱同时在写、Files 同时在读，接受最终一致就行。目录大小别每次列表都递归 du 一遍。

**GET /v1/workspaces/{workspace_id}/stats**

整个目录用了多少空间，返回 `bytes_used` 这类数字。目录很大时可以先回 calculating，别把接口卡住。列表不要顺手算这个。

**GET /v1/workspaces/{workspace_id}/files**

列目录，分页。query 里 `path`、`limit`、`cursor`。`path` 相对根。

第一页只传 `path`、`limit`；还有下一页的话，响应里带 `next_cursor`，下次请求把这个值放进 query 的 `cursor`。没有下一页，`next_cursor` 为空或不返回。

响应 `entries` 每项至少有 `name`、`type`（`dir` 或 `file`）、`size`（目录可为 null）、`mtime`。默认排序：目录在前、文件在后；同类型按名字排。

```http
GET /v1/workspaces/7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34/files?path=/src&limit=50
Authorization: Bearer <token>
```

```json
{
  "entries": [
    {
      "name": "components",
      "type": "dir",
      "size": null,
      "mtime": "2026-09-14T10:02:11Z"
    },
    {
      "name": "main.go",
      "type": "file",
      "size": 4821,
      "mtime": "2026-09-14T10:08:33Z"
    }
  ],
  "next_cursor": "eyJuIjoibWFpbi5nbyJ9"
}
```

**GET /v1/workspaces/{workspace_id}/files/content**

单文件流。**必须支持 Range / 206**——视频拖进度、大文件分段下，都靠这个。`Content-Disposition`：预览用 inline，下载用 attachment；PDF 丢进 iframe 预览走 inline。

浏览器 `<video src>`、iframe 塞 PDF 很难带 Authorization，这条走 Cookie，例子在下一节。

**GET /v1/workspaces/{workspace_id}/files/archive**

目录打包下载。query 里 `path` 相对根，把这棵子树打成 zip 或 tar，流式往外吐，别先落成一份临时大文件再回。单文件还是走 content；要拎走一个文件夹，走这条。

```http
GET /v1/workspaces/7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34/files/archive?path=/src
Authorization: Bearer <token>
```

**POST /v1/workspaces/{workspace_id}/files/rename**

body 里 `from` / `to`，必须在同一个 workspace。目标已存在就 409。

```http
POST /v1/workspaces/7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34/files/rename
Authorization: Bearer <token>
Content-Type: application/json

{
  "from": "/draft.md",
  "to": "/readme.md"
}
```

## 鉴权：Cookie

浏览器里 `<video src>`、iframe 塞 PDF，**很难把 Authorization 头带上**，内容流用 **HttpOnly Cookie** 更合适。

建议双通道：

- 内容流（播 / 预览 / 下载）：Cookie
- JSON 管理 API（Sessions、Files 元数据）：Cookie 与 Bearer 都认

Cookie 本身：HttpOnly、Secure、SameSite 用 Lax 或 Strict，路径能收窄就收窄，有效期短一点。写操作要防 CSRF。外链分享走短时签名 URL，别把长期 token 挂在 query 上。同站部署最省事；跨站 iframe 可能还是得短时签名 URL。

```http
GET /v1/workspaces/{id}/files/content?path=/a.mp4
Cookie: session=...
Range: bytes=0-1023
```

## 初期与演进

一期范围：单节点挂一份 JuiceFS；控制面和 CubeSandbox 可以同机、必须分进程；Host Mount 只绑定 `/data/shared/` 下的路径；会话按「建目录 / 新开沙箱 / 结束打快照再关」走通。开放注册先靠目录按需创建、沙箱用完即毁来消化流量，不上复杂的多租户存储 ACL。Files 面先做列表、单文件 Range 下载/预览、目录打包下载、重命名、归属校验、Cookie；异步 stats、更细的预览策略往后排。

这一期沙箱还不能在集群里漂移，挂载还绑在「这台节点已经挂了 JuiceFS」这个前提上。量上来、要调度、要把控制面和计算节点拆开之后，再上 Volume Plugin：多节点各自挂，按调度把 MicroVM 和对应目录放到一起。
