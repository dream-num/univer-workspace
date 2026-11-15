# S3 文件存储

[English](s3-storage.md) | 简体中文

设置 `BLOB_STORE=s3`，并将 `BLOB_S3_BUCKET` 设为已有的私有存储桶名称。通过
`BLOB_S3_REGION` 或 AWS 环境配置指定区域。使用 S3 兼容服务时，可通过
`BLOB_S3_ENDPOINT` 指定服务地址，按服务商要求启用 `BLOB_S3_FORCE_PATH_STYLE`。
要为对象键设置统一前缀，使用 `BLOB_S3_PREFIX`。[配置示例](../.env.example)

为服务端配置 IAM 角色或 AWS 凭据。该身份需要对存储桶有 `s3:ListBucket` 权限，对 Workspace
对象有 `s3:GetObject`、`s3:PutObject`、`s3:DeleteObject` 和 `s3:AbortMultipartUpload` 权限。
可通过存储桶生命周期规则清理未完成的分片上传。如果启用了版本控制，还可以设置已删除对象的历史版本保留时间。
Docker 部署仍需挂载持久卷来保存两个 SQLite 数据库。

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
