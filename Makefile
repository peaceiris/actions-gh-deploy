IMAGE_NAME := docker.pkg.github.com/peaceiris/actions-gh-pages/dev:latest
NODE_VERSION := $(shell cat ./.nvmrc)

.PHONY: build
build:
	docker-compose build --build-arg NODE_VERSION=$(NODE_VERSION)

.PHONY: run
run:
	docker-compose run --rm dev bash

.PHONY: pre-release
pre-release:
	npm run build
	git add ./lib
	git commit -m "chore: npm run build"

.PHONY: remove-pre-release
remove-pre-release:
	git rm -f ./lib
	git commit -m "chore: remove lib"
