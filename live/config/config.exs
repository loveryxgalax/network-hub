import Config

config :netops_live, NetopsLiveWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  # No url path: the routes, static files and socket already sit under /live.
  url: [host: "localhost"],
  render_errors: [formats: [html: NetopsLiveWeb.ErrorHTML], layout: false],
  pubsub_server: NetopsLive.PubSub,
  live_view: [signing_salt: "netops-live-view"]

config :phoenix, :json_library, Jason
config :logger, :console, format: "$time $metadata[$level] $message\n"

import_config "#{config_env()}.exs"
