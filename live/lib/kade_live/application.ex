defmodule KadeLive.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children =
      [
        {Phoenix.PubSub, name: KadeLive.PubSub},
        KadeLive.Feed,
        KadeLive.Events
      ] ++ [KadeLiveWeb.Endpoint]

    Supervisor.start_link(children, strategy: :one_for_one, name: KadeLive.Supervisor)
  end

  @impl true
  def config_change(changed, _new, removed) do
    KadeLiveWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
