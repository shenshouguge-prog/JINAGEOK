# CentOS 7.6 部署指南 (使用 Docker)

由于 CentOS 7.6 的系统库 (GLIBC) 版本较低，直接运行现代 Node.js 会报错。推荐使用 Docker 方案，它可以完美解决环境兼容性问题。

## 1. 安装 Docker 和 Docker Compose

在 CentOS 7.6 上执行以下命令：

```bash
# 更新系统
sudo yum update -y

# 安装 Docker 依赖
sudo yum install -y yum-utils device-mapper-persistent-data lvm2

# 添加 Docker 仓库
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 安装 Docker
sudo yum install -y docker-ce docker-ce-cli containerd.io

# 启动并设置自启
sudo systemctl start docker
sudo systemctl enable docker

# 安装 Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

## 2. 部署应用

1. 将项目代码上传到服务器目录（例如 `/opt/jinageok`）。
2. 在该目录下执行：

```bash
# 构建并启动容器
sudo docker-compose up -d
```

## 3. 常用命令

* **查看运行状态**：`sudo docker-compose ps`
* **查看日志**：`sudo docker-compose logs -f`
* **停止应用**：`sudo docker-compose down`
* **更新代码后重新部署**：
  ```bash
  git pull # 如果使用 git
  sudo docker-compose up -d --build
  ```

## 4. 注意事项

* **端口开放**：请确保服务器防火墙已开放 `3000` 端口。
* **数据持久化**：数据库文件 `ktv.db` 已通过 volume 映射到宿主机当前目录，容器重启或更新不会丢失数据。
* **音轨识别**：请确保您的视频资源文件名遵循 `-1` (伴奏) 和 `-2` (原唱) 的命名规则。
