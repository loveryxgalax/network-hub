defmodule NetopsLive.TestSessions do
  @moduledoc "Stand-in for the hub's sign-in check: tests decide what each session id answers."
  def set(sid, answer), do: :persistent_term.put({__MODULE__, sid}, answer)
  def check(sid), do: :persistent_term.get({__MODULE__, sid}, {:ok, true})
end

defmodule NetopsLive.TestActions do
  @moduledoc "Stand-in for the hub's action endpoint: records calls and answers what the test set."
  def set(answer), do: :persistent_term.put({__MODULE__, :answer}, answer)
  def calls, do: :persistent_term.get({__MODULE__, :calls}, [])
  def run(sid, action, id) do
    :persistent_term.put({__MODULE__, :calls}, [{sid, action, id} | calls()])
    :persistent_term.get({__MODULE__, :answer}, {:ok, %{"alert" => %{"title" => "RB951 is unreachable", "status" => "Acknowledged"}}})
  end
end

ExUnit.start()
