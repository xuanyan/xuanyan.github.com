---
layout: post
title: AI 沙箱存算分离方案
---

给 Agent 配沙箱这件事，现在几乎成了 AI 工具的标配：代码改在隔离环境里，跑完再看结果。真正麻烦的不是「怎么开一个沙箱」，而是 workspace 往哪放——文件要跟着会话活下去，计算节点却随时可以扔。开放注册的量又估不准，存储还得能扩、能换。下面聊一套沙箱存算分离方案。

<!-- more -->

## 背景

AI 产品给 Agent 的，通常是一个短命的执行环境：进去有一个工作目录，Agent 读写文件、跑命令，会话结束环境就拆掉。用户却希望下次还能接着干——仓库、草稿、中间产物都还在。这就把两件生命周期完全不同的事绑在了一起：

- **计算**是沙箱：开得快、关得干脆，坏了重建即可。
- **存储**是 workspace：要长期活着，还要能换盘、换机、换容量。

如果把文件直接堆在沙箱本地盘上，沙箱一毁数据就没了；如果按用户预分配一块「永远在线」的重资源，开放注册又扛不住——你不知道明天会涌进来多少人，也不能假设每个人都会持续占用很大空间。

所以目标很清楚：存算分开；存储层可扩可换；不要按峰值用户数去堆独占资源。

## 为何走挂载，而不是同步拉取回写

另一种常见做法是「开机把文件拉进来，关机再写回去」。听起来简单，开放注册场景里却很别扭。

workspace 可大可小。有人只有几个配置文件，有人扔了半个仓库加构建缓存。全量拉取意味着：会话启动被文件体量绑架；回写还要处理冲突、部分失败、中途杀掉。量一上来，同步窗口会变成控制面最难讲清楚的故障面。

挂载型反过来：**目录一直在存储层，沙箱只是临时看见它**。Agent 读写的就是那份真实数据，按需发生，没有「先拷一份再当正式版」的步骤。沙箱挂了，目录还在；新沙箱再挂上去，就是恢复。

对象存储放在挂载下面，是为了把「盘」从计算节点上拆走。容量跟着桶走，节点坏了换一台再挂；哪天不想自建了，也可以换成别的 S3 兼容后端，计算侧不用跟着翻盘。

## 选型

整条链拆成三截：POSIX 挂载、对象存储、沙箱怎么看见这块盘。

**挂载层用 JuiceFS**，元数据放 Redis，数据放对象存储。Agent 和用户面对的还是普通目录，不是对象 key。JuiceFS 负责把 POSIX 语义接到后面的桶上，节点上挂一次，上面的目录树就可以按租户/用户/workspace 往下切。

**对象存储用自建 MinIO**，走 S3 兼容接口。一期不绑某家公有云的对象服务，桶在自己这边，坏了、扩了、迁了都是存储侧的事。JuiceFS 认的是 S3，所以后端以后要换成别的兼容实现，挂载协议不用换。

**沙箱用腾讯 CubeSandbox，挂载方式选 Host Mount**。JuiceFS 挂在宿主机节点上，再 bind 进 MicroVM；沙箱里面**不自己去挂 JuiceFS**。这样沙箱进程看不见 Redis、看不见 MinIO 密钥，也少一截「每个虚拟机各自挂文件系统」的复杂度。宿主机已经把目录准备好了，沙箱只消费一个普通目录。

一期先做**节点单挂载**：一台机器挂好 JuiceFS，控制面可以跟沙箱跑在同一台机上（不同进程）。先把会话模型跑通，再谈调度。二期再看 Volume Plugin、多节点——那是挂载从「这台机的本地约定」变成「集群里可调度的卷」的阶段，不是一期要一次做完的事。

## 拓扑与信任边界

控制面和沙箱必须分开，哪怕暂时挤在同一台机器上。同机只是起步方式，不是把密钥和用户代码塞进同一个进程。

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

几条故意不做的决定：

- **密钥不进沙箱。** Redis、MinIO、JuiceFS 的访问凭证留在控制面和宿主机。沙箱里的 Agent 就算被提示词带跑，也拿不到存储后端。
- **不做每用户 Redis ACL。** 开放注册的量不可控，为每个用户维护一套元数据 ACL，运营成本和出错面都很大。隔离靠路径约定和挂载白名单，不靠「每人一把 Redis 钥匙」。
- **hostPath 必须落在 `/data/shared/` 白名单下。** 控制面再怎么拼路径，最终绑进 MicroVM 的宿主机路径都不能逃出这块前缀，避免把节点上别的目录挂进去。

控制面负责：鉴权、拼路径、建目录、向 CubeSandbox 下发 Host Mount、记录 sandbox 与 workspace 的对应关系。沙箱负责：在 `/workspace` 里干活。两边职责不交叉。

## 路径与会话模型

盘上的真实路径是分层的，沙箱里只暴露一个工作根目录：

```
宿主机: /data/shared/jfs/{tenant_id}/{user_id}/{workspace_id}
沙箱内: /workspace
```

`/data/shared/` 是 JuiceFS 在节点上的挂载前缀，也是 hostPath 白名单。再往下用租户、用户、workspace 切开，目录即隔离单元。Agent **只存 `workspace_id`**，不要去记沙箱 ID，也不要去拼宿主机路径——那些是控制面的事。

三个动作，对应三种生命周期操作：

**创建。** 控制面**新生成**一个 `workspace_id`（UUID），再按 `/data/shared/jfs/{tenant_id}/{user_id}/{workspace_id}` mkdir，拉起沙箱，Host Mount 到 `/workspace`。返回 `workspace_id` 和 `sandbox_id`，Agent 只把前者存下来。创建不做「目录有了就复用」——那是 restore 的事。

**恢复。** 先校验这个 workspace 是否属于当前租户和用户，再 ensure 目录还在（被误删就重建空目录，而不是悄悄挂到别人的路径上），然后**新开一个沙箱**，挂的还是同一条目录。恢复不是唤醒旧虚拟机，而是「短命计算」重新贴上「长寿目录」。

**结束。** 只关沙箱，不动目录。进程拆掉、MicroVM 回收；`/data/shared/jfs/.../workspace_id` 继续留着，下次 restore 还能挂上。

一句话：**目录长寿，沙箱短寿。** `workspace_id` 是用户侧的稳定句柄；`sandbox_id` 只覆盖这一次运行。

## API

对 Agent 只暴露会话，不暴露挂载细节。鉴权用 Bearer，控制面从 token 里解析租户和用户，路径里的 `{tenant_id}` / `{user_id}` 不让调用方随便填。

约定写死一条：**创建请求不传、也不认 body 里的 `workspace_id`**。身份只从 Bearer 来；要用已经存在的目录，必须走 restore。

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

只要 Authorization，没有 body。URL 里是本次 sandbox；目录靠 Agent 已经存下的 `workspace_id`，结束会话不删目录。成功是 **204**，没有响应体。

```http
DELETE /v1/sessions/sb_a04e
Authorization: Bearer <token>
```

restore 故意不收旧的 `sandbox_id`——旧沙箱可能已经没了，恢复只认目录。

## 初期与演进

一期把范围收死：单节点挂一份 JuiceFS；控制面和 CubeSandbox 可以同机、必须分进程；Host Mount 只绑定 `/data/shared/` 下的路径；会话模型按「建目录 / 新开沙箱 / 只关沙箱」走通。开放注册先靠「目录按需创建、沙箱用完即毁」来消化流量，而不是先上复杂的多租户存储 ACL。

这一期刻意留下的缺口也很明确：沙箱还不能在集群里漂移，挂载还绑在「这台节点已经挂了 JuiceFS」这个前提上。量上来、要调度、要把控制面和计算节点拆开之后，再上 Volume Plugin，让挂载变成可编排的卷，多节点各自挂、按调度把 MicroVM 和对应目录放到一起。

演进时不变的是信任边界和会话语义：密钥仍不进沙箱，Agent 仍只认 `workspace_id`，目录仍长寿、沙箱仍短寿。变的是「这块目录如何出现在某台节点上」——从人工约定的单机挂载，换成插件声明的卷。

## 小结

这套方案的核心不是某个组件名，而是三件绑在一起的选择：用挂载而不是同步拷贝，把 POSIX 目录落到 S3 兼容存储上；用 Host Mount 让沙箱看见目录、却看不见存储密钥；用「目录长寿、沙箱短寿」把 Agent 的句柄收成一个 `workspace_id`。

开放注册量不可控的时候，先别把隔离做进 Redis ACL，也别按用户预留重资源。路径切分、挂载白名单、控制面与沙箱分进程，已经够一期把存算分开。单节点能把模型跑明白，再把挂载交给 Volume Plugin 去多走几台机器。
