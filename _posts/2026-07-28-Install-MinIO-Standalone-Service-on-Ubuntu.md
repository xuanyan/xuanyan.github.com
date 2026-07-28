---
layout: post
title: Ubuntu安装MinIO单体服务
---

如何优雅的搭建MinIO单体服务？下面是我的部署步骤，其中桶权限为共有读私有写。适配 Ubuntu（含 20.04 / 22.04 / 24.04）。

<!-- more -->

1. 安装MinIO

```bash
# 如未安装 wget，先安装
sudo apt update
sudo apt install -y wget

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

Ubuntu 自定义 systemd 单元建议放在 `/etc/systemd/system/`（与 CentOS 的 `/usr/lib/systemd/system/` 不同）：

```bash
sudo vi /etc/systemd/system/minio.service
```

```bash
[Unit]
Description=Minio Service
After=network.target

[Service]
Type=simple
Environment="MINIO_ROOT_USER=minio"
Environment="MINIO_ROOT_PASSWORD=minio123456"
Environment="MINIO_BROWSER_REDIRECT=off"
ExecStart=/home/minio/minio server /home/minio/data --console-address ":9001" --address ":9000"
ExecReload=/bin/kill -s HUP $MAINPID
ExecStop=/bin/kill -s QUIT $MAINPID
StandardOutput=append:/home/minio/minio.log
StandardError=append:/home/minio/minio.log
PrivateTmp=true
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

3. 启动MinIO服务

```bash
#服务重载，每次编辑完minio.service需要执行
sudo systemctl daemon-reload

#启动服务
sudo systemctl start minio

#开机启动
sudo systemctl enable minio

#停止服务
sudo systemctl stop minio

#查看服务状态
sudo systemctl status minio
```

如需对外开放端口，可用 ufw：

```bash
sudo ufw allow 9000/tcp
sudo ufw allow 9001/tcp
sudo ufw reload
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

# 这是以前我的做法，但是不好，因为  download 预设策略里面会包含 ListBucket ，默认访问存储桶会列出文件列表
#./mc anonymous set download minio/demo

cat > anon_policy.json <<'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect":"Allow",
            "Principal":{"AWS":["*"]},
            "Action":["s3:GetObject"],
            "Resource":["arn:aws:s3:::demo/*"]
        }
    ]
}
EOF

./mc anonymous set-json anon_policy.json minio/demo


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
