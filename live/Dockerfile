# Phoenix live view (Phase 1). Built on the server, where the Hex package registry is reachable.
FROM hexpm/elixir:1.17.3-erlang-27.1.2-debian-bookworm-20241016-slim AS build
ENV MIX_ENV=prod
WORKDIR /app
RUN mix local.hex --force && mix local.rebar --force
COPY mix.exs mix.lock* ./
RUN mix deps.get --only prod && mix deps.compile
COPY config config
COPY lib lib
COPY priv priv
# The Phoenix and LiveView browser scripts ship inside their packages; no Node or esbuild needed.
RUN cp deps/phoenix/priv/static/phoenix.min.js deps/phoenix_live_view/priv/static/phoenix_live_view.min.js priv/static/assets/ \
 && mix compile && mix release

FROM debian:bookworm-20241016-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates && rm -rf /var/lib/apt/lists/* \
 && sed -i '/en_US.UTF-8/s/^# //' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 MIX_ENV=prod PHX_SERVER=true
WORKDIR /app
RUN useradd --system --home /app live
COPY --from=build --chown=live /app/_build/prod/rel/netops_live ./
USER live
EXPOSE 4000
CMD ["/app/bin/netops_live", "start"]
