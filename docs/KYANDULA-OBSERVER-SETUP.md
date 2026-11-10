# Task for Claude in the browser: connect RB951 (KYANDULA) to netops as a read-only observer

Paste everything below this line into Claude in the browser once you are logged in to **both**:
- the KYANDULA MikroTik's web page (WebFig), and
- netops (https://netops.kadenetworks.com) as an administrator.

---

## Your role and the hard rules

You are helping me connect one production MikroTik, **RB951 (KYANDULA)**, to my netops dashboard so netops can watch it. The router serves live paying customers through another platform (ISPman), so **nothing about how it serves customers may change**.

**You may only:**
1. Run the read-only commands listed below, exactly as written.
2. Paste the two scripts that netops generates (steps 4 and 5) into this router's terminal.
3. Click through netops as described.

**You must never:**
- Type, change or reveal any password. I log in myself. If a login prompt appears, stop and ask me.
- Run any RouterOS command not written in these instructions, even if it seems helpful. This includes anything under `/radius`, `/ppp`, `/ip hotspot`, `/queue`, `/ip firewall`, `/interface`, `/user`, `/system identity` and `/certificate`, and any reboot, reset, upgrade or `remove` other than the undo commands at the end.
- Use `check-certificate=no` or otherwise turn off HTTPS checks.
- Copy, quote or summarise the contents of the netops scripts in the chat, in notes or anywhere except this router's terminal. They contain a private key. Use netops' **Copy** button, then paste into the terminal.
- Touch any other router, or any ISPman page.
- Continue past a **STOP** condition. Report what you saw and wait for me.

**Opening the terminal.** In WebFig the terminal is the **Terminal** button (top right, or under the menu on small screens). Wait for the `[admin@…] >` prompt before typing. Paste with Ctrl+V (Cmd+V on Mac), then press Enter. Do one command at a time and read the output before the next.

## Step 1. Look and record (changes nothing)

Run each of these, one at a time, and write down the values I ask for:

```
/system resource print
```
Note:
- `version`: must be **7.16 or higher**.
- `free-memory`: should be **20 MiB or more**.
- `cpu-load`: note the number.
- `board-name`.

```
/system clock print
```
Note the date and time. It must be today's date and roughly the correct time for Nairobi.

```
/system script print
/system scheduler print
```
Note how many entries each list has, and whether any name already starts with `network-hub`.

```
/export compact file=kyandula-before-netops
```
This saves a copy of the configuration on the router. It changes nothing.

**STOP** and report to me if any of these is true:
- the version is lower than 7.16
- free memory is under 20 MiB
- the date is wrong
- `cpu-load` is above 70
- anything named `network-hub-…` already exists

Otherwise, continue.

## Step 2. Check the router can reach netops securely (changes nothing)

```
/tool fetch url="https://netops.kadenetworks.com/portal/" check-certificate=yes output=none
```
- If the output ends with `status: finished`, continue.
- **STOP** if it shows any error, especially one about certificates, SSL or TLS. Copy the exact error message to me. Do not try to fix it.

## Step 3. Make sure netops does not already have this router

In netops, open **MikroTik → Routers**. If a router named `RB951 (KYANDULA)` already exists there, **STOP** and tell me.

## Step 4. Add the monitoring reporter

1. In netops, open **Settings** and press **Connect with script**.
2. For **Router name**, enter exactly: `RB951 (KYANDULA)`.
3. Press **Generate connection script**.
4. Press **Copy script**. Do not read the script out or paste it anywhere else.
5. In the KYANDULA terminal, paste and press Enter.
6. Wait for the line **"Network Hub agent installed. Check the router in your dashboard after 30 seconds."**
   - **STOP** if you see `failure`, `error`, `bad command`, `syntax error` or `requires RouterOS`. Copy only the error line to me, not the script.
   - If the paste looks cut off (the prompt returns mid-script), **STOP** and tell me. Do not paste it a second time.
7. Close the netops dialog. Open **MikroTik → Routers**. Within about a minute `RB951 (KYANDULA)` should show as online. Note what you see.

## Step 5. Add the session reporter (customer discovery)

1. In netops, open **MikroTik → Customer discovery**. Find the **RB951 (KYANDULA)** card and press **Enable discovery**.
2. Press **Generate discovery script**, then **Copy private script**.
3. In the KYANDULA terminal, paste and press Enter. Wait for the prompt to return.
   - **STOP** on any error line (copy just that line to me).
4. Close the dialog in netops and press **Refresh observations**. Within about 2 minutes the KYANDULA card should say **Reporting**, and active PPP/Hotspot sessions should appear in the list.

## Step 6. Confirm nothing else changed

In the KYANDULA terminal:

```
/system script print
/system scheduler print
/system resource print
```
- Each list should now have exactly the entries it had in Step 1, **plus** `network-hub-agent` and `network-hub-discovery`. Nothing else should have changed.
- Note the `cpu-load`.

Then, without changing anything, check these in WebFig:
- **PPP → Active Connections** and **IP → Hotspot → Active** still show customers connected.
- **RADIUS** still shows the same entries as before. Only look at it; do not click Edit.

## Step 7. Report back to me

Give me a short summary:
- RouterOS version, free memory, and CPU load before and after.
- Result of the health check.
- Whether `RB951 (KYANDULA)` shows **online** under Routers.
- Whether the discovery card says **Reporting**, and how many PPP and Hotspot sessions netops shows.
- The number of active PPP and Hotspot connections on the router itself, for comparison.
- Any warnings or errors, word for word, but never script contents.

## Undo (only if I ask, or if CPU load stays above 80 for 10 minutes)

These remove only what netops added:

```
/system scheduler remove [find where name~"network-hub"]
/system script remove [find where name~"network-hub"]
```
Then tell me. I will remove the router from netops myself.
