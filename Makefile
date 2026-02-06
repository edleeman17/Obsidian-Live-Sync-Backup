.PHONY: build backup dry-run test clean

build:
	@echo "Building Docker image..."
	@docker compose build

backup: build
	@echo "Running backup..."
	@docker compose run --rm livesync-backup

dry-run: build
	@echo "Running dry-run..."
	@DRY_RUN=true docker compose run --rm livesync-backup

test:
	@echo "Running tests..."
	@docker compose run --rm --user root --entrypoint deno livesync-backup test --allow-read --allow-write --allow-env src/tests/

clean:
	@echo "Cleaning up Docker images..."
	@docker compose down --rmi local

rebuild: clean build

help:
	@echo "Available targets:"
	@echo "  build     - Build the Docker image"
	@echo "  backup    - Run a full backup"
	@echo "  dry-run   - Run in dry-run mode (no changes)"
	@echo "  test      - Run the test suite"
	@echo "  clean     - Remove Docker images"
	@echo "  rebuild   - Clean and rebuild from scratch"
