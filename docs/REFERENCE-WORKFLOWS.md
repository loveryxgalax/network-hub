# How the reference dashboard works

These are authenticated UI observations, supplemented by earlier REA runtime evidence. They describe visible behavior; Texin's private backend source was not available.

The dashboard summarizes an ISP workspace: routers, optical terminals and subscriber units contribute reachability, traffic, optical power and uptime observations. Alerts and work orders turn those observations into operator action. Summaries refresh without reloading the whole page.

OLT setup starts from a connected MikroTik, its OLT-facing interface, management IP and login services. Conflict checks and connection tests precede adding the detected equipment. This implies a management/provisioning service behind the form; saving an inventory record alone does not reproduce it.

ONU workflows separate configured/unconfigured serials. Authorization associates a detected unit with service configuration. Migration pre-registers a target PON/OLT and restores customer/service information upon rediscovery. Generic parent-reference edits do not complete that hardware workflow.

Zones describe areas; ODBs have numbered physical ports, capacity and coordinates. Speed plans distinguish download from fixed upstream. The observed EPON help treats fixed upstream as guaranteed bandwidth rather than an upload cap; each hardware driver needs validation. Saving a plan does not immediately change the OLT.

Presets automate workspace placement and local names for newly observed ONUs using {zone}, {odb}, {pon} and {onu}. Physical ONU renaming and TR-069 profile application are separate actions.

TR-069 uses an ACS to observe device check-ins and execute refresh/reboot/Wi-Fi/internet-VLAN operations. The reference also exposes bulk actions and router management-VLAN provisioning. A standalone system requires its own ACS, CPE authentication and management reachability.

Fibre combines routes/types/core counts, closures/trays, splice connectivity, optical observations and categorized inventory. The map combines coordinates, ONU status and fibre links, exports GIS files and offers a separately generated live feed. No feed was created during inspection.

Jobs store installation/repair details, contacts, priority, assignment and progress. Team roles distinguish owner, manager, technician, support and field installer; installers focus on authorization and assigned jobs.

The wallet funds Texin's own commercial licences/services using M-Pesa. AI has saved chats and prepaid tokens; SMS supplies notifications/reports; tickets connect to Texin support. Those are separate integrations/business services, not capabilities or balances inherited by copying a page.

The independent app implements local planning/jobs/accounting and protocol connections for RouterOS, SNMP and GenieACS. Vendor provisioning, VPN/WAN changes, AI, SMS and payment collection remain distinct implementation tasks. See [the status matrix](FEATURE-PARITY.md).
