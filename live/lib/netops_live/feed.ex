defmodule NetopsLive.Feed do
  @moduledoc """
  One process polls the hub's internal live feed and broadcasts each new snapshot on PubSub, so a hundred open
  screens cost the hub one request every few seconds. Viewers get the latest snapshot as soon as they connect.
  """
  use GenServer
  require Logger

  @topic "live"

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  def topic, do: @topic
  def latest, do: GenServer.call(__MODULE__, :latest)

  @doc "Used by tests (and the poller) to publish a snapshot."
  def publish(snapshot), do: GenServer.cast(__MODULE__, {:snapshot, snapshot})

  @impl true
  def init(_) do
    if interval() > 0 and (url() || NetopsLive.Hub.api_url()), do: send(self(), :poll)
    {:ok, %{snapshot: nil, error: nil}}
  end

  @impl true
  def handle_call(:latest, _from, state), do: {:reply, {state.snapshot, state.error}, state}

  @impl true
  def handle_cast({:snapshot, snapshot}, state), do: {:noreply, store(state, snapshot)}

  @impl true
  def handle_info(:poll, state) do
    state =
      case fetch() do
        {:ok, snapshot} -> store(state, snapshot)
        {:error, reason} ->
          if state.error != reason, do: Logger.warning("live feed: #{reason}")
          Phoenix.PubSub.broadcast(NetopsLive.PubSub, @topic, {:feed_error, reason})
          %{state | error: reason}
      end

    Process.send_after(self(), :poll, interval())
    {:noreply, state}
  end

  # Only changed snapshots are broadcast ("at" always changes, so it is left out of the comparison).
  defp store(state, snapshot) do
    if Map.delete(snapshot, "at") != (state.snapshot && Map.delete(state.snapshot, "at")) or state.error do
      Phoenix.PubSub.broadcast(NetopsLive.PubSub, @topic, {:snapshot, snapshot})
    end

    %{state | snapshot: snapshot, error: nil}
  end

  # The v1 snapshot (with its event cursor) unless an explicit feed URL is configured.
  defp fetch do
    case url() do
      nil -> NetopsLive.Hub.get("/snapshot")
      u -> NetopsLive.Hub.get_url(u)
    end
  end

  defp url, do: Application.get_env(:netops_live, :feed_url)
  defp interval, do: Application.get_env(:netops_live, :poll_ms, 3000)
end
