CR ?= univer-acr-registry.cn-shenzhen.cr.aliyuncs.com
NS ?= univer
REPOSITORY = colla-workspace
IMAGE_TAG ?= latest

IMAGE_DIR = ./apps/workspace

push_image:
	@docker build -f $(IMAGE_DIR)/Dockerfile -t $(CR)/$(NS)/$(REPOSITORY):$(IMAGE_TAG) . --push
