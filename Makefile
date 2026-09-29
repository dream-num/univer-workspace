CR ?= univer-acr-registry.cn-shenzhen.cr.aliyuncs.com
NS ?= univer
REPOSITORY = colla-workspace
IMAGE_TAG ?= latest
BASE_IMAGE ?= 
HTTP_PROXY ?=
PROXY_SSL ?=
NODE_MAX_OLD_SPACE_SIZE ?= 4096
ADD_HOST ?=

BASE_IMAGE_ARG =
ifneq ($(strip $(BASE_IMAGE)),)
BASE_IMAGE_ARG = --build-arg BASE_IMAGE="$(BASE_IMAGE)"
endif

ADD_HOST_OPT =
ifneq ($(strip $(ADD_HOST)),)
ADD_HOST_OPT = --add-host "$(ADD_HOST)"
endif


IMAGE_DIR = ./apps/workspace

push_image:
	@docker build \
		$(ADD_HOST_OPT) \
		$(BASE_IMAGE_ARG) \
		--build-arg HTTP_PROXY="$(HTTP_PROXY)" \
		--build-arg PROXY_SSL="$(PROXY_SSL)" \
		--build-arg NODE_MAX_OLD_SPACE_SIZE="$(NODE_MAX_OLD_SPACE_SIZE)" \
		--build-arg VITE_UNIVER_LICENSE="$${UNIVER_WORKSPACE_BROWSER_LICENSE}" \
		-f $(IMAGE_DIR)/Dockerfile \
		-t $(CR)/$(NS)/$(REPOSITORY):$(IMAGE_TAG) . --push
