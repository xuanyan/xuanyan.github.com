---
layout: post
title: CentOS安装MinIO单体服务
---

如何优雅的搭建MinIO单体服务？下面是我的部署步骤，其中桶权限为共有读私有写。

<!-- more -->

1. 安装MinIO

```bash

mkdir /home/minio

cd /home/minio
#数据保存目录
mkdir data

#minio服务
wget https://dl.min.io/server/minio/release/linux-amd64/minio
#mc客户端
wget https://dl.min.io/aistor/mc/release/linux-amd64/mc

chmod +x ./minio

chmod +x ./mc

```

2. 配置MinIO服务

vi /usr/lib/systemd/system/minio.service

```bash
[Unit]
Description=Minio Service

[Service]
Environment="MINIO_ROOT_USER=minio"
Environment="MINIO_ROOT_PASSWORD=minio123456"
ExecStart=/home/minio/minio server /home/minio/data --console-address ":9001" --address ":9000"
ExecReload=/bin/kill -s HUP $MAINPID
ExecStop=/bin/kill -s QUIT $MAINPID
StandardOutput=/home/minio/minio.log
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

3. 启动MinIO服务

```bash
#服务重载，每次编辑完minio.service需要执行
systemctl daemon-reload

#启动服务
systemctl start minio

#开机启动
systemctl enable minio

#停止服务
systemctl strop minio

#查看服务状态
systemctl status minio
```

4. mc 命令行工具

```bash
#创建别名minio（登录服务端）

./mc alias set minio http://127.0.0.1:9000 minio minio123456

#删除桶

./mc rb minio/demo --force

#创建桶 demo

./mc mb minio/demo

#给匿名用户只读权限

./mc anonymous set download minio/demo

#创建用户 demo-write-user 

./mc admin user add minio demo-write-user 123456
```

创建权限json

vi demo-policy.json

```json

 {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Action": "s3:*",
          "Resource": "arn:aws:s3:::demo/*"
        }
      ]
    }

```

```bash
#添加针对桶的写权限demo

./mc admin policy create minio demo ./demo-policy.json

#将权限demo 绑定到用户

./mc admin policy attach minio demo --user demo-write-user
```

通过nginx反代后，可能遇到报错：

`The request signature we calculated does not match the signature you provided. Check your key and signing method.`

参考下面配置：

https://minio.org.cn/docs/minio/linux/integrations/setup-nginx-proxy-with-minio.html