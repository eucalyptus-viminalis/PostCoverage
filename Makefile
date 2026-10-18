.PHONY: build fetch test package social-preview

SOCIAL_HTML ?= assets/social-preview.html
SOCIAL_PNG ?= assets/social-preview.png
SOCIAL_VIEWPORT ?= 1200,630

build:
	python3 build.py

fetch:
	python3 build.py --fetch

test: build
	node tests/run-keyword.mjs

package: test
	bash scripts/package_extension.sh

social-preview:
	bash scripts/capture_social_preview.sh "$(SOCIAL_HTML)" "$(SOCIAL_PNG)" "$(SOCIAL_VIEWPORT)"
