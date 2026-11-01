defmodule NetopsLive.TestSessions do
  @moduledoc "Stand-in for the hub's sign-in check: tests decide what each session id answers."
  def set(sid, answer), do: :persistent_term.put({__MODULE__, sid}, answer)
  def check(sid), do: :persistent_term.get({__MODULE__, sid}, {:ok, true})
end

ExUnit.start()
