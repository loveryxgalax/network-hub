defmodule NetopsLive.MixProject do
  use Mix.Project

  # Phase 1 of the Phoenix work: a live NOC view beside the Node netops app. No database; it reads the
  # Node app's internal live feed and pushes changes to everyone watching over LiveView.
  def project do
    [
      app: :netops_live,
      version: "0.1.0",
      elixir: "~> 1.15",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      releases: [netops_live: [include_executables_for: [:unix]]]
    ]
  end

  def application do
    [mod: {NetopsLive.Application, []}, extra_applications: [:logger, :inets, :ssl]]
  end

  defp deps do
    [
      {:phoenix, "~> 1.7.14"},
      {:phoenix_live_view, "~> 1.0.0"},
      {:phoenix_html, "~> 4.1"},
      {:bandit, "~> 1.5"},
      {:jason, "~> 1.4"},
      {:floki, ">= 0.30.0", only: :test}
    ]
  end
end
