FROM rust:1.82-slim AS build
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/inksight-sync /usr/local/bin/inksight-sync
ENV SYNC_ADDR=0.0.0.0:8787 SYNC_DB=/data/sync.db
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["inksight-sync"]
