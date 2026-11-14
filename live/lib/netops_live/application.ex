defmodule NetopsLive.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children =
      [
        {Phoenix.PubSub, name: NetopsLive.PubSub},
        NetopsLive.Feed,
        NetopsLive.Events
      ] ++ [NetopsLiveWeb.Endpoint]

    Supervisor.start_link(children, strategy: :one_for_one, name: NetopsLive.Supervisor)
  end

  @impl true
  def config_change(changed, _new, removed) do
    NetopsLiveWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
