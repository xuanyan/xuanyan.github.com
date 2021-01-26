---
layout: post
title: 使用macOS连接树莓派VNC服务的正确设置方法
---

#### 树莓派设置

菜单 > 首选项 > Raspberry Pi Configuration > Interfaces  勾选VNC选项的 Enable。

点下方的 OK 后，会在树莓派的系统托盘出现 VNC Server 图标，点击后可以看到树莓派的ip地址。

进入 Options 菜单：

进入 Security  选项卡: Encryption 选择 Prefer On. Authentication 选择 VNC Password。

进入 Users & Permissions 选项卡：选中 Standard User, 点击右侧的 Password 设置 密码，客户端连接的时候使用。

现在可以使用VNC客户端连接到树莓派了。

#### 客户端设置

macOS 下使用的客户端是 Jump Desktop，测试使用Screens也是可以的。认证选择 VNC password。

如果你和我一样想要在树莓派不连接显示器的时候使用vnc，那么你需要这么操作：

<!-- more -->

进入树莓派，打开终端，修改 /boot/config.txt ：

设置 `hdmi_force_hotplug=1` （ 默认被注释掉，只需要去掉前面的 `#`）。