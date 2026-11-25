from datetime import date, datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def new_id() -> str:
    return str(uuid4())


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, default="User")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    password_reset_token_hash: Mapped[str | None] = mapped_column(String)
    password_reset_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    status: Mapped[str] = mapped_column(String, default="Active")
    description: Mapped[str | None] = mapped_column(Text)
    contacts: Mapped[list["Contact"]] = relationship(back_populates="account")
    requirements: Mapped[list["Requirement"]] = relationship(back_populates="account")


class Contact(Base):
    __tablename__ = "contacts"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    stakeholder_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"), index=True)
    full_name: Mapped[str] = mapped_column(String)
    designation: Mapped[str | None] = mapped_column(String)
    practice: Mapped[str | None] = mapped_column(String)
    location: Mapped[str | None] = mapped_column(String)
    email: Mapped[str | None] = mapped_column(String, index=True)
    phone: Mapped[str | None] = mapped_column(String)
    relationship_rating: Mapped[str] = mapped_column(String, default="Cold")
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    reports_to_id: Mapped[str | None] = mapped_column(ForeignKey("contacts.id", ondelete="RESTRICT"))
    route_via_vendor_management: Mapped[bool] = mapped_column(Boolean, default=False)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_discussion: Mapped[str | None] = mapped_column(Text)
    next_action: Mapped[str | None] = mapped_column(Text)
    next_follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    engagement_stage: Mapped[str] = mapped_column(String, default="Mapped")
    expected_annual_value: Mapped[float | None] = mapped_column(Numeric)
    annual_target: Mapped[float | None] = mapped_column(Numeric)
    account: Mapped[Account] = relationship(back_populates="contacts")
    owner: Mapped[User | None] = relationship(foreign_keys=[owner_id])
    reports_to: Mapped["Contact | None"] = relationship(remote_side="Contact.id")
    activities: Mapped[list["Activity"]] = relationship(back_populates="contact")
    requirements: Mapped[list["Requirement"]] = relationship(back_populates="contact")


class Activity(Base):
    __tablename__ = "activities"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    contact_id: Mapped[str] = mapped_column(ForeignKey("contacts.id", ondelete="RESTRICT"), index=True)
    related_contact_ids: Mapped[list[str]] = mapped_column(ARRAY(Uuid(as_uuid=False)), default=list)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    type: Mapped[str] = mapped_column(String(40))
    outcome: Mapped[str | None] = mapped_column(String)
    meeting_level: Mapped[str | None] = mapped_column(String)
    attendees: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(String(250))
    next_action: Mapped[str | None] = mapped_column(Text)
    next_action_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_action_owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    logged_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    contact: Mapped[Contact] = relationship(back_populates="activities")
    logged_by: Mapped[User | None] = relationship(foreign_keys=[logged_by_id])
    next_action_owner: Mapped[User | None] = relationship(foreign_keys=[next_action_owner_id])


class FollowUpTask(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    contact_id: Mapped[str] = mapped_column(ForeignKey("contacts.id", ondelete="RESTRICT"), index=True)
    title: Mapped[str] = mapped_column(Text)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String, default="Pending")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    contact: Mapped[Contact] = relationship()
    owner: Mapped[User] = relationship()


class Requirement(Base):
    __tablename__ = "requirements"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    requirement_code: Mapped[str] = mapped_column(String, unique=True, index=True)
    contact_id: Mapped[str] = mapped_column(ForeignKey("contacts.id", ondelete="RESTRICT"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"), index=True)
    source_meeting_id: Mapped[str] = mapped_column(ForeignKey("activities.id", ondelete="RESTRICT"))
    role_title: Mapped[str] = mapped_column(String(160))
    skills: Mapped[str | None] = mapped_column(Text)
    positions_requested: Mapped[int] = mapped_column(Integer)
    experience_range: Mapped[str | None] = mapped_column(String)
    work_location: Mapped[str | None] = mapped_column(String)
    bd_owner: Mapped[str | None] = mapped_column(String)
    date_received: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    engagement_type: Mapped[str] = mapped_column(String(30), default="Contract")
    monthly_bill_rate: Mapped[float | None] = mapped_column(Numeric)
    contract_months: Mapped[int | None] = mapped_column(Integer)
    fee_per_hire: Mapped[float | None] = mapped_column(Numeric)
    project_value: Mapped[float | None] = mapped_column(Numeric)
    expected_margin_percent: Mapped[float | None] = mapped_column(Numeric)
    potential_revenue: Mapped[float] = mapped_column(Numeric, default=0)
    potential_bottom_line: Mapped[float] = mapped_column(Numeric, default=0)
    realised_revenue: Mapped[float] = mapped_column(Numeric, default=0)
    realised_bottom_line: Mapped[float] = mapped_column(Numeric, default=0)
    status: Mapped[str] = mapped_column(String, default="New")
    summary: Mapped[str] = mapped_column(String(250))
    contact: Mapped[Contact] = relationship(back_populates="requirements")
    account: Mapped[Account] = relationship(back_populates="requirements")
    source_meeting: Mapped[Activity] = relationship()
    positions: Mapped[list["Position"]] = relationship(back_populates="requirement", cascade="all, delete-orphan")


class Position(Base):
    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("requirement_id", "position_number"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    requirement_id: Mapped[str] = mapped_column(ForeignKey("requirements.id", ondelete="CASCADE"))
    position_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, default="Open")
    candidate_name: Mapped[str | None] = mapped_column(String)
    joining_date: Mapped[date | None] = mapped_column(Date)
    actual_bill_rate_or_fee: Mapped[float | None] = mapped_column(Numeric)
    actual_margin_percent: Mapped[float | None] = mapped_column(Numeric)
    requirement: Mapped[Requirement] = relationship(back_populates="positions")


class DropdownValue(Base):
    __tablename__ = "dropdown_values"
    __table_args__ = (UniqueConstraint("category", "value"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    category: Mapped[str] = mapped_column(String)
    value: Mapped[str] = mapped_column(String)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String)
    entity_type: Mapped[str] = mapped_column(String)
    record_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False))
    record_key: Mapped[str | None] = mapped_column(String)
    old_value: Mapped[dict | None] = mapped_column(JSONB)
    new_value: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NotificationSetting(Base):
    __tablename__ = "notification_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    weekly_report_recipients: Mapped[str] = mapped_column(Text, default="")


class NotificationRun(Base):
    __tablename__ = "notification_runs"
    __table_args__ = (UniqueConstraint("kind", "run_date"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String)
    run_date: Mapped[date] = mapped_column(Date)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SavedContactView(Base):
    __tablename__ = "saved_contact_views"
    __table_args__ = (UniqueConstraint("user_id", "name"),)
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String)
    base_view: Mapped[str] = mapped_column(String)
    query: Mapped[str] = mapped_column(Text, default="")
    rating_filter: Mapped[str] = mapped_column(String, default="")
    sort: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RecentContact(Base):
    __tablename__ = "recent_contacts"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    contact_id: Mapped[str] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), primary_key=True)
    viewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
