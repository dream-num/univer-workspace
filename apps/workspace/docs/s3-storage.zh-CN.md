# S3 文件存储

[English](s3-storage.md) | 简体中文

## 选择存储方式

**本地目录**是默认方式。要换目录，将 `BLOB_DIRECTORY` 设为服务端可写的路径。

```dotenv
BLOB_STORE=local
BLOB_DIRECTORY=.data/univer-workspace-blobs
```

**AWS S3** 需要一个已有的私有存储桶。将下面的桶名和区域换为实际值。如果已通过 `AWS_REGION`
或 AWS 配置文件指定区域，可省略 `BLOB_S3_REGION`。`BLOB_S3_PREFIX` 可选，默认将文件存到桶的根路径。

```dotenv
BLOB_STORE=s3
BLOB_S3_BUCKET=workspace-objects
BLOB_S3_REGION=us-east-1
```

**MinIO** 沿用上面的 S3 配置，再填入 Workspace 服务端可访问的 S3 API 地址。下面的示例使用路径式寻址。

```dotenv
BLOB_S3_ENDPOINT=http://minio:9000
BLOB_S3_FORCE_PATH_STYLE=true
```

可使用工作负载角色，或向服务端注入 `AWS_ACCESS_KEY_ID` 和 `AWS_SECRET_ACCESS_KEY`。临时凭据还需要
`AWS_SESSION_TOKEN`。该身份需要对存储桶有 `s3:ListBucket` 权限，对 Workspace
对象有 `s3:GetObject`、`s3:PutObject`、`s3:DeleteObject` 和 `s3:AbortMultipartUpload` 权限。
可通过存储桶生命周期规则清理未完成的分片上传。如果启用了版本控制，还可以设置已删除对象的历史版本保留时间。

## 部署时在哪里配置

已有部署请先[迁移本地文件](#将已有文件从本地迁移到-s3)，再启用 S3 配置。

- **本地开发**时，首次配置可将 [`.env.example`](../.env.example) 复制为 `apps/workspace/.env`。
  在该文件中填写存储配置，然后重启 `pnpm workspace:dev:server`。
- **Docker** 部署时，将存储配置写入 `workspace-storage.env`，在原有的 `docker run` 命令中加上
  `--env-file ./workspace-storage.env`，重新创建容器。继续将原数据卷挂载到 `/app/univer-workspace/.data`。
  文件存入 S3 后，两个 SQLite 数据库仍保存在该卷中。
- **Kubernetes** 部署时，在 Workspace 容器的 `env` 中设置 `BLOB_*`，通过工作负载身份或 Secret 提供凭据，
  保留原数据 PVC。使用本仓库的 [Deploy Workspace 工作流](../../../.github/workflows/push.yml)时，
  在发布前修改 `dream-num/helm-chart-private` 仓库 `deploy/colla-workspace/` 目录下目标环境的清单。

## 将已有文件从本地迁移到 S3

1. 停止所有 Workspace 服务实例，备份两个 SQLite 数据库以及 `BLOB_DIRECTORY` 指定的目录。
2. 将以 UUID 命名的文件原名复制到空的目标位置。例如，下面的命令将默认本地目录中的文件复制到
   `workspace-objects` 存储桶下的 `workspace` 前缀。

   ```bash
   aws s3 sync .data/univer-workspace-blobs/ s3://workspace-objects/workspace/ \
     --exclude '*' --include '????????-????-????-????-????????????' --no-follow-symlinks
   ```

3. 核对目标文件的数量、名称和大小。将 Workspace 配置为使用同一存储桶和前缀，重启服务，
   打开一个已有文件和一个文档内嵌附件，确认都能读取。

保留原始文件及其对应的数据库备份。恢复写入后如需回退，先停止 Workspace，再将新增对象复制回本地，
或同时恢复同一时间点的数据库和文件备份。
