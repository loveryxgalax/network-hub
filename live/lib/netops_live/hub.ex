defmodule NetopsLive.Hub do
  @moduledoc """
  The only way Phoenix talks to netops: GET requests to the hub's internal v1 API (private network, shared token).
  Phoenix has no database and never writes; Node stays the only writer.
  """

  @doc "GET `path` (e.g. \"/events?after=10\") from the internal API and decode the JSON body."
  def get(path) do
    case api_url() do
      nil -> {:error, "the hub address is not set"}
      base -> get_url(base <> path)
    end
  end

  def get_url(url) do
    headers = [{~c"authorization", String.to_charlist("Bearer " <> Application.fetch_env!(:netops_live, :token))}]

    case :httpc.request(:get, {String.to_charlist(url), headers}, [timeout: 5_000, connect_timeout: 3_000], body_format: :binary) do
      {:ok, {{_, 200, _}, _, body}} ->
        case Jason.decode(body) do
          {:ok, data} when is_map(data) -> {:ok, data}
          _ -> {:error, "the hub did not return JSON"}
        end

      {:ok, {{_, status, _}, _, _}} -> {:error, "the hub answered #{status}"}
      {:error, reason} -> {:error, "cannot reach the hub (#{inspect(reason)})"}
    end
  end

  def api_url, do: Application.get_env(:netops_live, :api_url)
end
