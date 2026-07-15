# Build context is the weather-insurance extension dir. The extension module pulls
# github.com/flare-foundation/tee-node v0.0.20 from the network — no on-disk
# sibling repo or replace directive is needed.

# Pin base image by digest so every build starts from the same bytes
FROM golang:1.25.1-trixie@sha256:ff83f3762390c2cccb53618ccc18af23e556aff9b1db4428637e9f63287c8171 AS builder

ARG SOURCE_DATE_EPOCH
ENV SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH

WORKDIR /build

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  if [ -z "${SOURCE_DATE_EPOCH}" ] || [ "${SOURCE_DATE_EPOCH}" = "0" ]; then \
    SOURCE_DATE_EPOCH="$(stat --format=%Y /etc/apt/sources.list.d/debian.sources)"; \
  fi && \
  snapshot="$(/bin/bash -euc "printf \"%(%Y%m%dT%H%M%SZ)T\n\" \"${SOURCE_DATE_EPOCH}\"")" && \
  : "Enabling snapshot" && \
  sed -i -e '/Types: deb/ a\Snapshot: true' /etc/apt/sources.list.d/debian.sources && \
  : "Enabling cache" && \
  rm -f /etc/apt/apt.conf.d/docker-clean && \
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache && \
  apt-get install --update --snapshot "${snapshot}" -o Acquire::Check-Valid-Until=false -o Acquire::https::Verify-Peer=false -y ca-certificates && \
  apt-get install --snapshot "${snapshot}" -y ca-certificates && \
  rm -rf /var/log/* /var/cache/ldconfig/aux-cache

COPY --chmod=644 --chown=0:0 go.mod go.sum ./
COPY --chmod=644 --chown=0:0 cmd/ ./cmd/
COPY --chmod=644 --chown=0:0 internal/ ./internal/
COPY --chmod=644 --chown=0:0 pkg/ ./pkg/

RUN go mod download
RUN go mod verify

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOFLAGS="-buildvcs=false" \
    go build -trimpath -ldflags="-buildid= -s -w" -o /app/extension-tee ./cmd/docker

RUN : "${SOURCE_DATE_EPOCH:=$(date +%s)}" && find /app -exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} +

FROM gcr.io/distroless/static

WORKDIR /app

COPY --chmod=644 --chown=65532:65532 --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chmod=755 --chown=65532:65532 --from=builder /app/extension-tee /app/extension-tee

ENV MODE=0 CONFIG_PORT=5501 SIGN_PORT=7701 EXTENSION_PORT=7702

USER 0:0

LABEL "tee.launch_policy.allow_env_override"="LOG_LEVEL,PROXY_URL,INITIAL_OWNER,EXTENSION_ID,CHAIN_URL,MODE,CONFIG_PORT,SIGN_PORT,EXTENSION_PORT,OPENWEATHERMAP_API_KEY"

EXPOSE 5501 7701 7702

CMD ["/app/extension-tee"]
