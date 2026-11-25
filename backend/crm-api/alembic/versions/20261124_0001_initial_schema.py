"""Create initial CRM PostgreSQL schema and seed standard choices."""
from alembic import op

from app.database import Base
from app import models  # noqa: F401

revision = "20261124_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(bind=op.get_bind())
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_audit_event_mutation() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'Audit history is append-only'; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER prevent_audit_event_mutation
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
    """)
    op.execute("""
        INSERT INTO dropdown_values (id, category, value, sort_order, is_active) VALUES
        (gen_random_uuid(),'Location','Bangalore',0,true),(gen_random_uuid(),'Location','Chennai',1,true),
        (gen_random_uuid(),'Location','Coimbatore',2,true),(gen_random_uuid(),'Location','Delhi',3,true),
        (gen_random_uuid(),'Location','Gurgaon',4,true),(gen_random_uuid(),'Location','Hyderabad',5,true),
        (gen_random_uuid(),'Location','Mumbai',6,true),(gen_random_uuid(),'Location','Noida',7,true),
        (gen_random_uuid(),'Location','Pune',8,true),(gen_random_uuid(),'Location','US',9,true),
        (gen_random_uuid(),'Location','Japan',10,true),(gen_random_uuid(),'Location','Romania',11,true),
        (gen_random_uuid(),'Location','Other',12,true),(gen_random_uuid(),'RelationshipRating','Hot',0,true),
        (gen_random_uuid(),'RelationshipRating','Warm',1,true),(gen_random_uuid(),'RelationshipRating','Slightly Warm',2,true),
        (gen_random_uuid(),'RelationshipRating','Cold',3,true),(gen_random_uuid(),'RelationshipRating','Parked',4,true),
        (gen_random_uuid(),'ActivityType','Call',0,true),(gen_random_uuid(),'ActivityType','Email',1,true),
        (gen_random_uuid(),'ActivityType','LinkedIn',2,true),(gen_random_uuid(),'ActivityType','WhatsApp',3,true),
        (gen_random_uuid(),'ActivityType','Meeting (formal)',4,true),(gen_random_uuid(),'ActivityType','Meeting (informal)',5,true),
        (gen_random_uuid(),'ActivityType','Event',6,true),(gen_random_uuid(),'ActivityOutcome','Connected',0,true),
        (gen_random_uuid(),'ActivityOutcome','No Answer',1,true),(gen_random_uuid(),'ActivityOutcome','Call Back Later',2,true),
        (gen_random_uuid(),'ActivityOutcome','Route via Vendor Management',3,true),(gen_random_uuid(),'ActivityOutcome','Not Interested',4,true),
        (gen_random_uuid(),'RequirementStatus','New',0,true),(gen_random_uuid(),'RequirementStatus','Profiles Shared',1,true),
        (gen_random_uuid(),'RequirementStatus','Interviews',2,true),(gen_random_uuid(),'RequirementStatus','Offer Made',3,true),
        (gen_random_uuid(),'RequirementStatus','Partially Filled',4,true),(gen_random_uuid(),'RequirementStatus','Closed Won',5,true),
        (gen_random_uuid(),'RequirementStatus','Closed Lost',6,true),(gen_random_uuid(),'RequirementStatus','On Hold',7,true),
        (gen_random_uuid(),'DefaultMarginPercent','20',0,true),
        (gen_random_uuid(),'DefaultMarginPercent:Contract','20',0,true),
        (gen_random_uuid(),'DefaultMarginPercent:Permanent hire','20',0,true),
        (gen_random_uuid(),'DefaultMarginPercent:Project/RPO','20',0,true)
    """)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS prevent_audit_event_mutation ON audit_events")
    op.execute("DROP FUNCTION IF EXISTS prevent_audit_event_mutation()")
    Base.metadata.drop_all(bind=op.get_bind())
