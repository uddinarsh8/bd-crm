"""Singleton background worker for scheduled BD CRM email notifications."""

from datetime import datetime, time, timedelta, timezone
import logging
import time as sleep_time
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import send_email
from app.models import Activity, Account, Contact, FollowUpTask, NotificationRun, NotificationSetting, Requirement, User
from app.settings import settings

log = logging.getLogger("bdcrm.notifications")
INDIA = ZoneInfo("Asia/Kolkata")


def run_daily_task_reminders(db, today):
    if not settings.smtp_host or not settings.smtp_from:
        return 0
    end_of_today_utc = datetime.combine(today + timedelta(days=1), time.min, tzinfo=INDIA).astimezone(timezone.utc)
    tasks = db.scalars(
        select(FollowUpTask)
        .where(FollowUpTask.status != "Completed", FollowUpTask.due_at < end_of_today_utc)
        .order_by(FollowUpTask.owner_id, FollowUpTask.due_at)
    ).all()
    by_owner = {}
    for task in tasks:
        by_owner.setdefault(task.owner_id, []).append(task)

    sent = 0
    for owner_id, owner_tasks in by_owner.items():
        run_kind = f"daily-tasks:{owner_id}"
        if db.scalar(select(NotificationRun.id).where(NotificationRun.kind == run_kind, NotificationRun.run_date == today)):
            continue
        owner = db.get(User, owner_id)
        if not owner or not owner.is_active:
            continue
        lines = [f"- {task.title} — due {task.due_at.astimezone(INDIA).date().isoformat()} (contact: {task.contact.full_name})" for task in owner_tasks]
        body = "Your BD CRM follow-ups due today or overdue:\n\n" + "\n".join(lines) + "\n\nOpen BD CRM to update or complete these tasks."
        try:
            if send_email(owner.email, "Your BD CRM follow-ups", body):
                db.add(NotificationRun(kind=run_kind, run_date=today)); db.commit(); sent += 1
        except Exception:
            db.rollback()
            log.exception("Could not send daily follow-up email to user %s", owner_id)
    return sent


def run_weekly_leadership_report(db, today):
    if today.weekday() != 0 or not settings.smtp_host or not settings.smtp_from:
        return 0
    run_kind = "weekly-leadership-report"
    if db.scalar(select(NotificationRun.id).where(NotificationRun.kind == run_kind, NotificationRun.run_date == today)):
        return 0
    setting = db.get(NotificationSetting, 1)
    recipients = [email.strip() for email in (setting.weekly_report_recipients if setting else "").replace(",", ";").split(";") if email.strip()]
    if not recipients:
        return 0

    open_requirements = db.scalar(select(func.count(Requirement.id)).where(Requirement.status.not_in(["Closed Won", "Closed Lost"]))) or 0
    open_positions = db.scalar(select(func.coalesce(func.sum(Requirement.positions_requested), 0)).where(Requirement.status.not_in(["Closed Won", "Closed Lost"]))) or 0
    overdue = db.scalar(select(func.count(FollowUpTask.id)).where(FollowUpTask.status != "Completed", FollowUpTask.due_at < datetime.combine(today, time.min, tzinfo=INDIA).astimezone(timezone.utc))) or 0
    contacts = db.scalar(select(func.count(Contact.id))) or 0
    accounts = db.scalar(select(func.count(Account.id))) or 0
    week_start = datetime.combine(today - timedelta(days=7), time.min, tzinfo=INDIA).astimezone(timezone.utc)
    activity_count = db.scalar(select(func.count(Activity.id)).where(Activity.occurred_at >= week_start)) or 0
    body = (
        f"BD CRM weekly summary for the week ending {today.isoformat()} (India time)\n\n"
        f"Accounts: {accounts}\nStakeholders: {contacts}\n"
        f"Activities logged in the last 7 days: {activity_count}\n"
        f"Open requirements: {open_requirements}\nPositions requested on open requirements: {open_positions}\n"
        f"Overdue follow-ups: {overdue}\n\nOpen BD CRM Reports for details."
    )
    delivered = 0
    for recipient in recipients:
        try:
            delivered += bool(send_email(recipient, "BD CRM weekly leadership summary", body))
        except Exception:
            log.exception("Could not send weekly leadership report to %s", recipient)
    if delivered:
        db.add(NotificationRun(kind=run_kind, run_date=today)); db.commit()
    return delivered


def run_due_notifications():
    now = datetime.now(INDIA)
    if now.hour < 9:
        return
    today = now.date()
    with SessionLocal() as db:
        try:
            run_daily_task_reminders(db, today)
            run_weekly_leadership_report(db, today)
        except Exception:
            db.rollback()
            log.exception("Scheduled BD CRM notifications failed")


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    log.info("BD CRM notification worker started; checks run every minute after 09:00 Asia/Kolkata")
    while True:
        run_due_notifications()
        sleep_time.sleep(60)


if __name__ == "__main__":
    main()
