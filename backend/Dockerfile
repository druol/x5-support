FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
ARG COMMIT=unknown
RUN CGO_ENABLED=0 go build -trimpath \
  -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
  -o /tickets ./cmd/tickets

FROM build AS test
CMD ["go", "test", "-count=1", "-v", "./..."]

FROM alpine:3.22 AS runtime
RUN addgroup -S support && adduser -S support -G support
COPY --from=build /tickets /usr/local/bin/tickets
USER support
EXPOSE 8080
ENTRYPOINT ["tickets"]
CMD ["api"]
