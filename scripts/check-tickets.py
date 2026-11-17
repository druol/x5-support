#!/usr/bin/env python3
"""End-to-end API acceptance. --recovery stops/restarts only LOCAL notification/API services.
Creates one persistent test ticket; never truncates or deletes existing data.
"""
import argparse
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base-url", default="http://127.0.0.1:8090")
parser.add_argument("--recovery", action="store_true")
args = parser.parse_args()
if args.recovery and urllib.parse.urlparse(args.base_url).hostname not in ("127.0.0.1", "localhost"):
    parser.error("--recovery is only supported for the local Compose stack")


def api(path, body=None, expected=200):
    request = urllib.request.Request(args.base_url + "/api" + path,
                                    data=None if body is None else json.dumps(body).encode(),
                                    headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            code, result = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        code, result = error.code, json.load(error)
    assert code == expected, (path, code, result)
    return result


def compose(*arguments):
    subprocess.run(["docker", "compose", *arguments], check=True)


def sql(statement):
    return subprocess.check_output(
        ["docker", "compose", "exec", "-T", "postgres", "sh", "-c",
         'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],
        input=statement, text=True).strip()


def wait_for(check, description):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (urllib.error.URLError, AssertionError, TimeoutError, json.JSONDecodeError):
            pass
        time.sleep(0.5)
    raise AssertionError("Timed out: " + description)


stopped = False
try:
    api("/healthz")
    ticket = api("/user/tickets", {"topic": "service", "title": "Проверка сценария " + time.strftime("%H:%M:%S"),
                                   "description": "Автоматическая проверка полного цикла из PDF."}, 201)
    ticket_id = int(ticket["id"])
    user, admin = f"/user/tickets/{ticket_id}", f"/admin/tickets/{ticket_id}"
    assert ticket["status"] == "new"
    if args.recovery:
        compose("stop", "notifications")
        stopped = True
    api(admin + "/status", {"status": "in_progress"})
    api(admin + "/comments", {"comment": "Проверяем проблему"})
    api(admin + "/status", {"status": "done", "comment": " "}, 400)
    api(admin + "/status", {"status": "done", "comment": "Сервис восстановлен"})
    api(user + "/status", {"status": "in_progress", "comment": ""}, 400)
    api(user + "/status", {"status": "in_progress", "comment": "Ошибка повторилась"})
    api(user + "/status", {"status": "in_progress", "comment": "Повтор"}, 409)
    detail = api(user)
    assert detail["status"] == "in_progress" and len(detail["history"]) == 5
    assert all(entry["actor"] and entry["created_at"] for entry in detail["history"])
    filtered = api("/admin/tickets?topic=service&status=in_progress")["items"]
    assert any(item["id"] == ticket_id for item in filtered)
    print(f"PASS: ticket #{ticket_id}, full lifecycle, required comments, history and filters", flush=True)
    if args.recovery:
        assert sql(f"SELECT count(*) FROM ticketing.outbox WHERE ticket_id={ticket_id} AND delivered_at IS NULL;") == "3"
        assert sql(f"SELECT count(*) FROM notifications.items WHERE ticket_id={ticket_id};") == "0"
        compose("start", "notifications")
        stopped = False

    def notifications():
        return [item for item in api("/notifications")["items"] if item["ticket_id"] == ticket_id]

    items = wait_for(lambda: (items if len(items) == 3 else None) if (items := notifications()) else None,
                     "three notifications")
    assert items[0]["message"] == "Заявка выполнена: Сервис восстановлен"
    unread = api("/notifications")["unread"]
    api(f'/notifications/{items[0]["id"]}/read', {})
    api(f'/notifications/{items[0]["id"]}/read', {})
    assert api("/notifications")["unread"] == unread - 1
    if args.recovery:
        # Simulate transport replay. Unique event_id must preserve read_at.
        sql(f"UPDATE ticketing.outbox SET delivered_at=NULL WHERE ticket_id={ticket_id};")
        wait_for(lambda: sql(f"SELECT count(*) FROM ticketing.outbox WHERE ticket_id={ticket_id} AND delivered_at IS NULL;") == "0", "outbox replay")
        compose("restart", "backend", "notifications")
        wait_for(lambda: api("/healthz"), "API restart")
        wait_for(lambda: api("/notifications"), "notification restart")
    final = notifications()
    assert len(final) == 3 and len({item["event_id"] for item in final}) == 3
    assert final[0]["read_at"] and api(user)["status"] == "in_progress"
    print("PASS: asynchronous notifications, newest first, read state, no duplicates" +
          (", outage recovery, replay and service restarts" if args.recovery else ""), flush=True)
finally:
    if stopped:
        compose("start", "notifications")
