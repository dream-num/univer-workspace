# S3 文件存储

[English](s3-storage.md) | 简体中文

本页说明 PostgreSQL + S3 部署所需的对象存储权限和文件复制命令。数据库与文件存储的完整配置、停机顺序、数据库导入和切换验收见 [Workspace 配置指南](configuration.zh-CN.md#从-sqlite-和本地目录迁移)。

**MinIO** 沿用配置指南中的 S3 配置，再填入 Workspace 服务端可访问的 S3 API 地址。下面的示例使用路径式寻址。

```dotenv
BLOB_S3_ENDPOINT=http://minio:9000
BLOB_S3_FORCE_PATH_STYLE=true
```

可使用工作负载角色，或向服务端注入 `AWS_ACCESS_KEY_ID` 和 `AWS_SECRET_ACCESS_KEY`。临时凭据还需要
`AWS_SESSION_TOKEN`。该身份需要对存储桶有 `s3:ListBucket` 权限，对 Workspace
对象有 `s3:GetObject`、`s3:PutObject`、`s3:DeleteObject` 和 `s3:AbortMultipartUpload` 权限。
可通过存储桶生命周期规则清理未完成的分片上传。如果启用了版本控制，还可以设置已删除对象的历史版本保留时间。

## 部署时在哪里配置

- **本地启动**时，将数据库和文件存储配置一起写入 `apps/workspace/.env`。
- **Docker** 部署时，创建容器时通过 `--env-file ./workspace.env` 一起传入数据库和文件存储配置。迁移期间保留原数据卷。
- **Kubernetes** 部署时，在 Workspace 容器的 `env` 中设置数据库和 S3 环境变量，通过工作负载身份或 Secret 提供凭据，
  保留原数据 PVC。使用本仓库的 [Deploy Workspace 工作流](../../../.github/workflows/push.yml)时，
  在发布前修改 `dream-num/helm-chart-private` 仓库 `deploy/colla-workspace/` 目录下目标环境的清单。

## 将已有文件从本地迁移到 S3

源实例停写并完成备份后，从实际的 `BLOB_DIRECTORY` 复制到空前缀。下面使用默认本地目录，目标与配置示例一致。

```bash
aws s3 sync .data/univer-workspace-blobs/ s3://workspace-objects/workspace/ \
  --exclude '*' --include '????????-????-????-????-????????????' --no-follow-symlinks
```

保留原有 UUID 文件名。核对对象名称、数量和大小后，继续导入产品库和协同库，两步都完成后再启动目标服务验收。
