defmodule KadeLiveWeb.Router do
  use KadeLiveWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug KadeLiveWeb.Proxied
    plug :fetch_live_flash
    plug :put_root_layout, html: {KadeLiveWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers, %{
      "content-security-policy" =>
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'"
    }
  end

  scope "/live", KadeLiveWeb do
    pipe_through :browser

    live_session :noc, session: {KadeLiveWeb.Proxied, :live_session, []}, on_mount: KadeLiveWeb.Proxied do
      live "/", NocLive, :index
    end
  end
end
