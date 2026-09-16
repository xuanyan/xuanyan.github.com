---
layout: post
title: AI 沙箱存算分离方案
---

给 Agent 配沙箱现在基本是标配：代码改在隔离环境里，跑完再看结果。workspace 得跟着会话活下去，计算节点却随时可以扔。开放注册量也估不准，存储还得能扩、能换。下面把讨论下来的做法写一下，方便对选型和 API。

<!-- more -->

## 背景

沙箱是短命的。进去有个工作目录，Agent 读写文件、跑命令，会话结束环境就拆掉。用户又希望下次还能接着干——仓库、草稿、中间产物都还在。

计算这边：沙箱开得快、关得干脆，坏了重建即可。存储这边：workspace 要长期活着，还能换盘、换机、换容量。别把文件堆在沙箱本地盘上，沙箱一毁数据就没了。

按用户预分配一块「永远在线」的重资源也不合适。开放注册扛不住——不知道明天涌进来多少人，也不能假设每个人都会持续占很大空间。存算分开，存储做成可扩可换的，别按峰值用户数去堆独占资源。

## 为何走挂载，而不是同步拉取回写

另一种常见做法：开机把文件拉进来，关机再写回去。听起来简单，开放注册场景里挺别扭。

workspace 可大可小。有人几个配置文件，有人半个仓库加构建缓存。全量拉取的话，会话启动会被文件体量绑架；回写还要处理冲突、部分失败、中途杀掉。量上来之后，这块同步窗口会变成控制面很难讲清楚的故障面。

我们倾向挂载。目录一直在存储层，沙箱只是临时看见它。Agent 读写的就是那份真实数据，按需发生，没有「先拷一份再当正式版」。沙箱挂了，目录还在；新沙箱再挂上去，就是恢复。

对象存储放在挂载下面，是为了把「盘」从计算节点上拆走。容量跟着桶走，节点坏了换一台再挂。哪天不想自建了，换成别的 S3 兼容后端也行，计算侧不用跟着翻盘。

## 选型

挂载层、对象存储、沙箱怎么看见这块盘，分开选。

挂载层用 JuiceFS，元数据放 Redis，数据放对象存储。Agent 和用户面对的还是普通目录，不是对象 key。节点上挂一次，上面的目录树按租户 / 用户 / workspace 往下切就行。

对象存储用自建 MinIO，走 S3 兼容。一期不绑某家公有云，桶在自己这边。JuiceFS 认的是 S3，以后后端换成别的兼容实现，挂载协议不用换。

沙箱用腾讯 CubeSandbox，挂载方式选 Host Mount。JuiceFS 挂在宿主机节点上，再 bind 进 MicroVM；沙箱里面**不自己去挂 JuiceFS**。这样沙箱进程看不见 Redis、看不见 MinIO 密钥，也少一截「每个虚拟机各自挂文件系统」的复杂度。宿主机把目录准备好，沙箱只消费一个普通目录。

一期先做节点单挂载：一台机器挂好 JuiceFS，控制面可以跟沙箱跑在同一台机上（不同进程）。先把会话模型跑通。二期再上 Volume Plugin、多节点，挂载才能在集群里调度。那不是一期要一次做完的事。

## 拓扑与信任边界

控制面和沙箱必须分开，哪怕暂时挤在同一台机器上。同机只是起步，不是把密钥和用户代码塞进同一个进程。

```
  Agent (只拿 workspace_id)
           |
           |  HTTPS + Bearer
           v
     +-----------+          同机不同进程即可起步
     |  控制面   |          Redis / MinIO 密钥停在这里
     +-----------+
           |
           |  建目录 / 开停沙箱 / Host Mount
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

控制面管鉴权、拼路径、建目录、向 CubeSandbox 下发 Host Mount、记录 sandbox 与 workspace 的对应关系。沙箱就在 `/workspace` 里干活。

## 路径与会话模型

盘上真实路径是分层的，沙箱里只暴露一个工作根目录：

```
宿主机: /data/shared/jfs/{tenant_id}/{user_id}/{workspace_id}
沙箱内: /workspace
```

`/data/shared/` 是 JuiceFS 在节点上的挂载前缀，也是 hostPath 白名单。再往下用租户、用户、workspace 切开，目录即隔离单元。Agent **只存 `workspace_id`**，不要去记沙箱 ID，也不要去拼宿主机路径——那些是控制面的事。

三个动作：

**创建。** 控制面**新生成**一个 `workspace_id`（UUID），再按 `/data/shared/jfs/{tenant_id}/{user_id}/{workspace_id}` mkdir，拉起沙箱，Host Mount 到 `/workspace`。返回 `workspace_id` 和 `sandbox_id`，Agent 只把前者存下来。创建不做「目录有了就复用」——那是 restore 的事。

**恢复。** 先校验这个 workspace 是否属于当前租户和用户，再 ensure 目录还在（被误删就重建空目录，别悄悄挂到别人的路径上），然后**新开一个沙箱**，挂的还是同一条目录。不是唤醒旧虚拟机，是短命计算重新贴上长寿目录。

**结束。** 只关沙箱，不动目录。进程拆掉、MicroVM 回收；`/data/shared/jfs/.../workspace_id` 继续留着，下次 restore 还能挂上。

目录长寿，沙箱短寿。`workspace_id` 是用户侧的稳定句柄；`sandbox_id` 只覆盖这一次运行。

## API

对 Agent 只暴露会话，不暴露挂载细节。这些 JSON 接口 Bearer 就能调；控制面从身份里解析租户和用户，路径里的 `{tenant_id}` / `{user_id}` 不让调用方随便填。浏览器预览、下载走 Cookie，后面单独说。

创建请求不传、也不认 body 里的 `workspace_id`。租户和用户只从鉴权里取，不从 body 里填；要用已经存在的目录，走 restore。

**POST /v1/sessions（创建）**

请求可以没有 body，或者给一个空 JSON `{}`——里面不要出现 `workspace_id`。控制面自己生成 UUID、建目录、再开沙箱。

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

请求必传 `workspace_id`（还是上面那个 UUID）。校验归属之后，新开一个沙箱，挂回同一条目录。

```http
POST /v1/sessions/restore
Authorization: Bearer <token>
Content-Type: application/json

{
  "workspace_id": "7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34"
}
```

```json
{
  "workspace_id": "7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34",
  "sandbox_id": "sb_a04e",
  "mount_path": "/workspace",
  "status": "running"
}
```

**DELETE /v1/sessions/{sandbox_id}**

只要鉴权，没有 body。URL 里是本次 sandbox；目录靠 Agent 已经存下的 `workspace_id`，结束会话不删目录。成功是 **204**，没有响应体。

```http
DELETE /v1/sessions/sb_a04e
Authorization: Bearer <token>
```

restore 不收旧的 `sandbox_id`。旧沙箱可能已经没了，恢复只认目录。

## 为什么还要 Files 面

实际用的时候，用户未必先开沙箱。先看这个空间占了多大、里面有哪些文件、下载一份、预览一段视频（拖进度那种）、iframe 里看 PDF、给文件改个名——这些都不该绑在「沙箱必须在跑」。

Sessions 管算力：开、恢复、关。Files 管目录：列表、读内容、改名。两边共用同一条路径 `/data/shared/jfs/{tenant_id}/{user_id}/{workspace_id}`。没开沙箱，控制面照样打这条 JuiceFS 挂载路径。

## Files API

控制面直接打挂载上的目录，不经过沙箱。`path` 都相对 workspace 根，带 `..` 的直接拒。沙箱同时在写、Files 同时在读，接受最终一致就行。目录大小别每次列表都递归 du 一遍。

**GET /v1/workspaces/{workspace_id}/stats**

整个目录用了多少空间，返回 `bytes_used` 这类数字。目录很大时可以先回 calculating，别把接口卡住。列表不要顺手算这个。

**GET /v1/workspaces/{workspace_id}/files**

列目录，分页。query 里 `path`、`limit`、`cursor`。`path` 相对根。

```http
GET /v1/workspaces/7f3a9c2e-4b81-4d6a-9e12-0c8f5a1b2d34/files?path=/src&limit=50
Authorization: Bearer <token>
```

**GET /v1/workspaces/{workspace_id}/files/content**

单文件流。**必须支持 Range / 206**——视频拖进度、大文件分段下，都靠这个。`Content-Disposition`：预览用 inline，下载用 attachment；PDF 丢进 iframe 预览走 inline。目录打包下载一期可后做。

浏览器 `<video src>`、iframe 塞 PDF 很难带 Authorization，这条走 Cookie，例子在下一节。

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

一期范围：单节点挂一份 JuiceFS；控制面和 CubeSandbox 可以同机、必须分进程；Host Mount 只绑定 `/data/shared/` 下的路径；会话按「建目录 / 新开沙箱 / 只关沙箱」走通。开放注册先靠目录按需创建、沙箱用完即毁来消化流量，不上复杂的多租户存储 ACL。Files 面先做列表、单文件 Range 下载/预览、重命名、归属校验、Cookie；异步 stats、目录打包、更细的预览策略往后排。

这一期沙箱还不能在集群里漂移，挂载还绑在「这台节点已经挂了 JuiceFS」这个前提上。量上来、要调度、要把控制面和计算节点拆开之后，再上 Volume Plugin：多节点各自挂，按调度把 MicroVM 和对应目录放到一起。
