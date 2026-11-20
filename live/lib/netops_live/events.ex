defmodule NetopsLive.Events do
  @moduledoc """
  Follows the hub's event outbox with a cursor (alert opened, router down, payment received, customer
  connected…). One process for every viewer: it asks for events after the last one it saw about once a second,
  keeps the latest 50 and broadcasts new ones on PubSub.

  After a restart it starts from the latest events (no cursor), so viewers see recent activity at once; if the
  hub says the cursor no longer exists (database restored), it starts again the same way. The delay between an
  event happening and reaching here is kept as `lag_ms` and shown on the screen and on /healthz.
  """
  use GenServer
  require Logger

  @topic "events"
  @keep 50

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  def topic, do: @topic

  @doc "Latest events (newest first) and the consumer's state."
  def recent, do: GenServer.call(__MODULE__, :recent)

  @doc "Feed one hub response through the consumer (used by the poller and by tests)."
  def ingest(response, now \\ System.system_time(:millisecond)), do: GenServer.call(__MODULE__, {:ingest, response, now})

  @impl true
  def init(_) do
    if interval() > 0 and NetopsLive.Hub.api_url(), do: send(self(), :poll)
    {:ok, %{cursor: nil, events: [], lag_ms: nil, last_ok_at: nil, error: nil, received: 0}}
  end

  @impl true
  def handle_call(:recent, _from, state), do: {:reply, {state.events, stats(state)}, state}

  def handle_call({:ingest, response, now}, _from, state) do
    state = apply_response(state, response, now)
    {:reply, {state.events, stats(state)}, state}
  end

  @impl true
  def handle_info(:poll, state) do
    path = if state.cursor, do: "/events?after=#{state.cursor}&limit=200", else: "/events?limit=#{@keep}"

    state =
      case NetopsLive.Hub.get(path) do
        {:ok, response} -> apply_response(state, response, System.system_time(:millisecond))
        {:error, reason} ->
          if state.error != reason, do: Logger.warning("live events: #{reason}")
          %{state | error: reason}
      end

    Process.send_after(self(), :poll, interval())
    {:noreply, state}
  end

  defp apply_response(state, %{"events" => events, "last" => last} = response, now) when is_list(events) do
    fresh = response["reset"] == true or state.cursor == nil
    new = if fresh, do: events, else: Enum.filter(events, &(is_integer(&1["seq"]) and &1["seq"] > state.cursor))
    newest_first = Enum.reverse(new)
    kept = if fresh, do: Enum.take(newest_first, @keep), else: Enum.take(newest_first ++ state.events, @keep)
    cursor = Enum.max([last | Enum.map(new, & &1["seq"])], fn -> last end)

    lag =
      with false <- fresh,
           [e | _] <- newest_first,
           t when is_number(t) <- e["time"] do
        max(0, now - t)
      else
        _ -> state.lag_ms
      end

    if new != [] or fresh do
      Phoenix.PubSub.broadcast(NetopsLive.PubSub, @topic, {:events, kept, %{reset: fresh, lag_ms: lag}})
    end

    %{state | cursor: cursor, events: kept, lag_ms: lag, last_ok_at: now, error: nil, received: state.received + length(new)}
  end

  defp apply_response(state, _other, _now), do: %{state | error: "the hub sent an unexpected event list"}

  defp stats(state), do: Map.take(state, [:cursor, :lag_ms, :last_ok_at, :error, :received])
  defp interval, do: Application.get_env(:netops_live, :events_ms, 1000)
end
