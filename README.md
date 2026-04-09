# feishu-demo

## 本地 Docker 部署

```bash
docker compose up -d --build
```

服务会监听宿主机 `3030` 端口，容器内绑定 `0.0.0.0`，局域网设备可通过：

```text
http://<宿主机局域网IP>:3030
```

常用命令：

```bash
docker compose logs -f
docker compose down
```

数据会持久化到项目目录下的 `./data`。
