import Config

config :kade_live, KadeLiveWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  # No url path: the routes, static files and socket already sit under /live.
  url: [host: "localhost"],
  render_errors: [formats: [html: KadeLiveWeb.ErrorHTML], layout: false],
  pubsub_server: KadeLive.PubSub,
  live_view: [signing_salt: "kade-live-view"]

config :phoenix, :json_library, Jason
config :logger, :console, format: "$time $metadata[$level] $message\n"

import_config "#{config_env()}.exs"
