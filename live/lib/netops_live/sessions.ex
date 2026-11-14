defmodule NetopsLive.Sessions do
  @moduledoc """
  Is this netops sign-in still valid? Each live screen asks every 30 seconds with the session id the hub gave it,
  so signing out of netops (or an admin turning the account off) ends the live view as well.
  """

  @callback check(String.t()) :: {:ok, boolean()} | {:error, term()}

  def check(sid) when is_binary(sid) and byte_size(sid) == 64 do
    case NetopsLive.Hub.get("/session?sid=" <> sid) do
      {:ok, %{"valid" => valid}} -> {:ok, valid == true}
      {:ok, _} -> {:error, "unexpected answer"}
      {:error, reason} -> {:error, reason}
    end
  end

  def check(_), do: {:ok, false}

  @doc "The checker in use (tests swap in their own)."
  def checker, do: Application.get_env(:netops_live, :session_checker, __MODULE__)
end
