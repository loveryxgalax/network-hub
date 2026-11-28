defmodule KadeLiveWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :kade_live

  @session_options [store: :cookie, key: "_kade_live", path: "/live", signing_salt: "kade-live", same_site: "Lax", secure: true]

  # Browsers reach this only through the hub, which checks the Kade Cloud sign-in first; the websocket path is
  # /live/live because everything here sits under /live on the public site.
  socket "/live/live", Phoenix.LiveView.Socket,
    websocket: [connect_info: [:x_headers, session: @session_options]],
    longpoll: false

  # Health first: private network only (the hub forwards nothing but /live).
  plug KadeLiveWeb.Health
  plug Plug.Static, at: "/live", from: :kade_live, gzip: false, only: KadeLiveWeb.static_paths()
  plug Plug.RequestId
  plug Plug.Parsers, parsers: [:urlencoded], pass: ["*/*"]
  plug Plug.Head
  plug Plug.Session, @session_options
  plug KadeLiveWeb.Router
end
