from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT = Path(__file__).with_name("accidentreport.pdf")
NAVY = HexColor("#17324D")
BLUE = HexColor("#2266AA")
DARK = HexColor("#263238")
MID = HexColor("#5F6B73")
LIGHT = HexColor("#D9E2E8")
PALE_BLUE = HexColor("#EAF3FA")
PALE_GREEN = HexColor("#EAF7EF")
PALE_RED = HexColor("#FCEBEC")
GREEN = HexColor("#147A43")
RED = HexColor("#B42318")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CoverTitleX", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=25, leading=30, textColor=NAVY, alignment=TA_CENTER, spaceAfter=10))
styles.add(ParagraphStyle(name="CoverSubX", parent=styles["Normal"], fontSize=12, leading=17, textColor=MID, alignment=TA_CENTER))
styles.add(ParagraphStyle(name="H1X", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=NAVY, spaceBefore=5, spaceAfter=9, keepWithNext=True))
styles.add(ParagraphStyle(name="H2X", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=BLUE, spaceBefore=9, spaceAfter=5, keepWithNext=True))
styles.add(ParagraphStyle(name="BodyX", parent=styles["BodyText"], fontSize=9.2, leading=13.2, textColor=DARK, spaceAfter=6))
styles.add(ParagraphStyle(name="SmallX", parent=styles["BodyText"], fontSize=7.7, leading=10.5, textColor=MID, spaceAfter=3))
styles.add(ParagraphStyle(name="BulletX", parent=styles["BodyText"], fontSize=9, leading=12.5, textColor=DARK, leftIndent=13, firstLineIndent=-7, bulletIndent=4, spaceAfter=3))
styles.add(ParagraphStyle(name="CalloutX", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=NAVY, leftIndent=8, rightIndent=8, spaceBefore=5, spaceAfter=5))
styles.add(ParagraphStyle(name="CodeX", parent=styles["Code"], fontName="Courier", fontSize=7.4, leading=10, textColor=DARK, backColor=HexColor("#F4F6F8"), borderColor=LIGHT, borderWidth=0.5, borderPadding=6, spaceBefore=4, spaceAfter=7))
styles.add(ParagraphStyle(name="THX", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.white))
styles.add(ParagraphStyle(name="TCX", parent=styles["BodyText"], fontSize=7.8, leading=10.2, textColor=DARK))
styles.add(ParagraphStyle(name="TBX", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=7.8, leading=10.2, textColor=DARK))
styles.add(ParagraphStyle(name="GoodX", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=8.2, leading=10, textColor=GREEN))
styles.add(ParagraphStyle(name="RiskX", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=8.2, leading=10, textColor=RED))


def p(text, style="BodyX"):
    return Paragraph(text, styles[style])


def bullet(text):
    return Paragraph("&bull; " + text, styles["BulletX"])


def grid(rows, widths, header=True, highlights=None):
    result = Table(rows, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.35, LIGHT),
    ]
    if header:
        commands.append(("BACKGROUND", (0, 0), (-1, 0), NAVY))
        start = 1
    else:
        start = 0
    for row in range(start, len(rows)):
        background = (highlights or {}).get(row, colors.white if row % 2 else HexColor("#F8FAFB"))
        commands.append(("BACKGROUND", (0, row), (-1, row), background))
    result.setStyle(TableStyle(commands))
    return result


def footer(canvas, doc):
    canvas.saveState()
    width, _ = A4
    canvas.setStrokeColor(LIGHT)
    canvas.line(18 * mm, 15 * mm, width - 18 * mm, 15 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MID)
    canvas.drawString(18 * mm, 10.5 * mm, "DentalCloud Production Incident Report | Internal Management Use")
    canvas.drawRightString(width - 18 * mm, 10.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


story = [
    Spacer(1, 28 * mm),
    p("DentalCloud Production Incident Report", "CoverTitleX"),
    p("PostgREST Connection Pool Exhaustion and Automatic ONP Request Amplification", "CoverSubX"),
    Spacer(1, 10 * mm),
    HRFlowable(width="72%", thickness=1.2, color=BLUE, hAlign="CENTER"),
    Spacer(1, 12 * mm),
]
metadata = [
    [p("Report date", "TBX"), p("21 September 2026", "TCX")],
    [p("Incident window", "TBX"), p("20-21 September 2026", "TCX")],
    [p("Affected system", "TBX"), p("DentalCloud production application and self-hosted Supabase data API", "TCX")],
    [p("Severity", "TBX"), p("SEV-1 - client-facing data service outage", "RiskX")],
    [p("Current status", "TBX"), p("Resolved; permanent mitigation deployed and monitored", "GoodX")],
    [p("Triggering change", "TBX"), p("0a107c6 - Batch automatic ONP patient updates", "TCX")],
    [p("Corrective change", "TBX"), p("1b7bc4d - Prevent concurrent automatic ONP refresh storms", "TCX")],
]
story += [grid(metadata, [42 * mm, 113 * mm], header=False, highlights={3: PALE_RED, 4: PALE_GREEN}), Spacer(1, 15 * mm)]
story += [grid([[p("<b>Classification:</b> Internal Management Use", "SmallX")]], [155 * mm], header=False, highlights={0: PALE_BLUE}), Spacer(1, 28 * mm)]
story += [p("Prepared from repository history, production service logs, database diagnostics, recovery records, and post-remediation validation results.", "SmallX"), PageBreak()]

story += [p("1. Executive Summary", "H1X")]
story += [p("DentalCloud experienced a client-facing data-service outage when PostgREST, the REST gateway used by the application to access PostgreSQL, could no longer acquire connections from its internal pool. PostgreSQL remained healthy, but application data requests returned <b>HTTP 503</b> with <b>PGRST003</b> and subsequently <b>PGRST002</b>.")]
story += [grid([[p("Management conclusion", "THX")], [p("The outage was caused by application request amplification interacting with a small PostgREST connection pool. A code change deployed the previous evening converted one large automatic ONP update into many sequential PATCH requests. Routine patient reads could trigger this work, while simultaneous users or tabs could run duplicate full scans and update sequences. The permanent fix replaces that pattern with one atomic, advisory-locked database RPC, adds client-side single-flight and cooldown controls, and adds an independent health watchdog.", "CalloutX")]], [155 * mm], highlights={1: PALE_BLUE}), Spacer(1, 4 * mm)]
story += [p("Assurance statement", "H2X"), p("The same specific failure mode is now strongly mitigated at three independent layers: request reduction and locking in the database, duplicate suppression and cooldown in the client, and automatic recovery through a server watchdog. This materially reduces recurrence risk. No production system can responsibly be guaranteed never to fail; unrelated defects, infrastructure faults, provider outages, or future changes can still cause downtime.")]
summary = [
    [p("Area", "THX"), p("Outcome", "THX")],
    [p("Service recovery", "TBX"), p("PostgREST restored without restarting PostgreSQL; Auth and Storage remained available.", "TCX")],
    [p("Permanent correction", "TBX"), p("Atomic database RPC, transaction advisory lock, client single-flight, and five-minute cooldown deployed.", "TCX")],
    [p("Prevention", "TBX"), p("One-minute three-strike watchdog verifies a real authenticated query and restarts only PostgREST when PostgreSQL is healthy.", "TCX")],
    [p("Validation", "TBX"), p("483 tests passed, TypeScript passed, production build passed, and 12 concurrent production RPC calls returned 200.", "TCX")],
]
story += [grid(summary, [42 * mm, 113 * mm])]

story += [p("2. Business Impact", "H1X")]
story += [
    bullet("Clients could reach the frontend, but data-dependent screens and workflows failed because REST database calls returned HTTP 503."),
    bullet("Authentication and Storage remained healthy; the incident was concentrated in the PostgREST data API."),
    bullet("No evidence of database corruption or data loss was found."),
    bullet("A logical database backup was created before remediation, and the existing daily backup passed integrity validation."),
]

story += [p("3. Scope and Affected Components", "H1X")]
components = [
    [p("Component", "THX"), p("State", "THX"), p("Finding", "THX")],
    [p("Frontend / Netlify", "TBX"), p("Reachable", "GoodX"), p("HTTP 200; application shell loaded.", "TCX")],
    [p("Nginx / Kong", "TBX"), p("Reachable", "GoodX"), p("Proxy path available and returning upstream responses.", "TCX")],
    [p("Supabase Auth", "TBX"), p("Healthy", "GoodX"), p("Health endpoint returned HTTP 200.", "TCX")],
    [p("Supabase Storage", "TBX"), p("Healthy", "GoodX"), p("Status endpoint returned HTTP 200.", "TCX")],
    [p("PostgreSQL", "TBX"), p("Healthy", "GoodX"), p("27/100 sessions, no blockers, no idle-in-transaction sessions.", "TCX")],
    [p("PostgREST", "TBX"), p("Failed", "RiskX"), p("Pool timeouts and schema-cache failures; HTTP 503.", "TCX")],
]
story += [grid(components, [37 * mm, 27 * mm, 91 * mm]), PageBreak()]

story += [p("4. Incident Timeline", "H1X")]
timeline = [
    [p("Time (Myanmar, UTC+06:30)", "THX"), p("Event", "THX")],
    [p("20 Sep, 19:38", "TBX"), p("Commit <b>0a107c6</b> changed automatic ONP updates from one bulk PATCH to URL-safe batches of 20.", "TCX")],
    [p("20 Sep, 22:42", "TBX"), p("First confirmed <b>PGRST003</b> pool acquisition timeout appeared in production logs.", "TCX")],
    [p("21 Sep, morning", "TBX"), p("Client-visible outage reported. REST requests returned HTTP 503 while the host, proxy, Auth, and Storage remained reachable.", "TCX")],
    [p("21 Sep, 11:04", "TBX"), p("Logical backup completed and checksummed. Only <b>supabase-rest</b> was restarted.", "TCX")],
    [p("21 Sep, 11:05", "TBX"), p("PostgREST rebuilt its schema cache and real REST table queries returned HTTP 200.", "TCX")],
    [p("21 Sep, 11:12", "TBX"), p("PostgREST watchdog and hardened backup permissions activated.", "TCX")],
    [p("21 Sep, 11:23", "TBX"), p("Corrective commit <b>1b7bc4d</b> created and pushed to origin/main.", "TCX")],
    [p("Post-fix", "TBX"), p("Atomic RPC deployed and tested with 12 simultaneous calls; all returned HTTP 200 with no PGRST002/PGRST003 recurrence.", "TCX")],
]
story += [grid(timeline, [43 * mm, 112 * mm])]

story += [p("5. Technical Root Cause", "H1X")]
story += [p("PostgREST had a default pool size of ten database connections. The application tied automatic data maintenance to routine patient retrieval. The last commit changed the write phase from one oversized update into multiple PATCH requests, solving proxy request-line limits but increasing request volume and duration.")]
story += [p("Request amplification before correction", "H2X"), p("For <i>N</i> eligible patients, one refresh could generate approximately:"), p("1 settings query + 1 full eligibility scan + ceil(N / 20) PATCH requests + the requested patient read", "CodeX")]
story += [p("Full patient retrieval was used by startup, dashboards, exports, assistant loading, patient profile loading, and refreshes. Multiple users or tabs could overlap the same work because there was no shared lock, single-flight guard, or cooldown.")]
causes = [
    [p("Category", "THX"), p("Finding", "THX")],
    [p("Primary cause", "TBX"), p("Automatic ONP maintenance was triggered from read paths and expanded into many PostgREST PATCH requests.", "TCX")],
    [p("Triggering change", "TBX"), p("Commit 0a107c6 introduced sequential batches of 20, increasing request count per conversion.", "TCX")],
    [p("Concurrency gap", "TBX"), p("No guard prevented multiple clients or tabs from running the same conversion.", "TCX")],
    [p("Capacity factor", "TBX"), p("A ten-connection PostgREST pool provided limited headroom for overlapping sequences.", "TCX")],
    [p("Detection gap", "TBX"), p("No real-query watchdog automatically recovered a running but unhealthy PostgREST service.", "TCX")],
]
story += [grid(causes, [38 * mm, 117 * mm])]
story += [p("Why PostgreSQL looked healthy", "H2X"), p("PostgreSQL accepted direct connections and had remaining capacity. The failure existed in PostgREST pool and schema-cache state, so database process health alone did not detect the client-facing outage."), PageBreak()]

story += [p("6. Code Defect Analysis", "H1X")]
defects = [
    [p("Before permanent fix", "THX"), p("Risk", "THX")],
    [p("Routine patient reads invoked automatic maintenance.", "TCX"), p("A read unexpectedly created writes and extra latency.", "TCX")],
    [p("Eligible patients were converted in batches of 20 PATCH requests.", "TCX"), p("Request count grew linearly with eligible-patient count.", "TCX")],
    [p("Every client instance could launch the same operation.", "TCX"), p("Workstations and tabs duplicated scans and updates.", "TCX")],
    [p("No shared lock or completed-run cooldown existed.", "TCX"), p("Repeated work could consume the pool.", "TCX")],
]
story += [grid(defects, [77.5 * mm, 77.5 * mm])]
story += [p("The batching commit was reasonable for its stated objective—preventing Nginx/Kong request-line overflow—but it treated the transport symptom rather than the maintenance-job architecture. The outage arose from the interaction of increased request count, read-path triggering, and missing concurrency control.")]

story += [p("7. Corrective Design", "H1X")]
fixes = [
    [p("Control", "THX"), p("Implementation", "THX"), p("Effect", "THX")],
    [p("Atomic RPC", "TBX"), p("apply_auto_onp_patient_type(UUID)", "TCX"), p("One REST call and one database UPDATE replace scan-plus-many-PATCH behavior.", "TCX")],
    [p("Database lock", "TBX"), p("pg_try_advisory_xact_lock per branch", "TCX"), p("Only one branch refresh runs; duplicates return immediately.", "TCX")],
    [p("Least privilege", "TBX"), p("SECURITY INVOKER", "TCX"), p("The function cannot bypass existing caller permissions.", "TCX")],
    [p("Client single-flight", "TBX"), p("Per-branch in-flight promise", "TCX"), p("Concurrent calls in one client share one operation.", "TCX")],
    [p("Client cooldown", "TBX"), p("Five minutes per branch", "TCX"), p("Repeated reads do not repeatedly start maintenance.", "TCX")],
    [p("Compatibility", "TBX"), p("Legacy batching only if RPC is absent", "TCX"), p("Allows safe rolling deployment.", "TCX")],
    [p("Watchdog", "TBX"), p("Real query every minute; three strikes", "TCX"), p("Restarts only PostgREST when PostgreSQL is healthy.", "TCX")],
]
story += [grid(fixes, [32 * mm, 55 * mm, 68 * mm])]

story += [p("8. Recovery and Safety Actions", "H1X")]
story += [
    bullet("Captured host, container, connection, and authentication evidence before service changes."),
    bullet("Created a root-only logical PostgreSQL backup and checksum before restart."),
    bullet("Restarted only PostgREST; PostgreSQL, Auth, and Storage were not restarted."),
    bullet("Restricted Kong, Portainer, Studio, and database/pooler ports to loopback."),
    bullet("Validated daily backup integrity and changed future backup permissions to root-only."),
    bullet("Installed a watchdog that tests a real authenticated data query."),
    PageBreak(),
]

story += [p("9. Validation Evidence", "H1X")]
validation = [
    [p("Validation", "THX"), p("Result", "THX"), p("Evidence", "THX")],
    [p("Focused regression tests", "TBX"), p("PASS", "GoodX"), p("4 of 4 ONP and migration tests passed.", "TCX")],
    [p("Full automated suite", "TBX"), p("PASS", "GoodX"), p("104 test files; 483 tests passed.", "TCX")],
    [p("TypeScript", "TBX"), p("PASS", "GoodX"), p("No diagnostics.", "TCX")],
    [p("Production build", "TBX"), p("PASS", "GoodX"), p("Vite transformed 3,411 modules successfully.", "TCX")],
    [p("RPC concurrency", "TBX"), p("PASS", "GoodX"), p("12 simultaneous calls; all HTTP 200; maximum 3.063 seconds.", "TCX")],
    [p("Connection recovery", "TBX"), p("PASS", "GoodX"), p("PostgREST returned to six idle connections.", "TCX")],
    [p("Error recurrence", "TBX"), p("PASS", "GoodX"), p("No PGRST002/PGRST003 entries after recovery during acceptance checks.", "TCX")],
    [p("Live business queries", "TBX"), p("PASS", "GoodX"), p("locations and app_settings returned HTTP 200.", "TCX")],
    [p("Watchdog", "TBX"), p("PASS", "GoodX"), p("Enabled, active, executing each minute, and reporting WATCHDOG_OK.", "TCX")],
]
story += [grid(validation, [43 * mm, 24 * mm, 88 * mm])]

story += [p("10. Recurrence Risk Assessment", "H1X")]
risk = [
    [p("Risk", "THX"), p("Before", "THX"), p("After", "THX"), p("Rationale", "THX")],
    [p("Same ONP request storm", "TBX"), p("High", "RiskX"), p("Low", "GoodX"), p("One RPC, lock, single-flight, and cooldown remove the amplification path.", "TCX")],
    [p("PostgREST stale state", "TBX"), p("High", "RiskX"), p("Low-Medium", "TCX"), p("The watchdog detects real-query failure and performs a narrow restart.", "TCX")],
    [p("Other high-volume paths", "TBX"), p("Medium", "TCX"), p("Medium", "TCX"), p("Unrelated queries still require concurrency budgets and load testing.", "TCX")],
    [p("Infrastructure failure", "TBX"), p("Medium", "TCX"), p("Medium", "TCX"), p("Code cannot eliminate host, DNS, storage, network, or provider outages.", "TCX")],
]
story += [grid(risk, [40 * mm, 20 * mm, 25 * mm, 70 * mm])]
story += [grid([[p("Answer to the recurrence question", "THX")], [p("The corrected architecture is specifically designed to prevent the same automatic-ONP request amplification from exhausting PostgREST again. Code-level prevention and server-side automatic recovery were both validated in production. This is a strong risk reduction, not an absolute guarantee of zero future downtime.", "CalloutX")]], [155 * mm], highlights={1: PALE_GREEN})]

story += [p("11. Recommended Management Actions", "H1X")]
actions = [
    [p("Priority", "THX"), p("Action", "THX"), p("Owner / cadence", "THX")],
    [p("P1", "TBX"), p("Add external monitoring for authenticated REST business queries, latency, and consecutive HTTP 5xx failures.", "TCX"), p("Infrastructure / immediate", "TCX")],
    [p("P1", "TBX"), p("Rotate any credentials disclosed during incident handling and maintain an approved access-key inventory.", "TCX"), p("Security / immediate", "TCX")],
    [p("P1", "TBX"), p("Test database restoration from backup, not only backup creation.", "TCX"), p("Infrastructure / monthly", "TCX")],
    [p("P2", "TBX"), p("Add multi-client load tests for startup and maintenance features.", "TCX"), p("Engineering / before release", "TCX")],
    [p("P2", "TBX"), p("Require concurrency and request-budget review for writes triggered from read paths.", "TCX"), p("Engineering / pull requests", "TCX")],
    [p("P2", "TBX"), p("Track pool acquisition timeouts, request latency, and status rates on a dashboard.", "TCX"), p("Infrastructure / ongoing", "TCX")],
]
story += [grid(actions, [18 * mm, 94 * mm, 43 * mm]), PageBreak()]

story += [p("12. Lessons Learned", "H1X")]
story += [
    bullet("<b>Fix the architectural cause, not only the transport symptom.</b> Splitting URLs prevented proxy rejection but increased load; the correct boundary was one atomic operation."),
    bullet("<b>Reads should not silently trigger unbounded maintenance writes.</b> If unavoidable, use deduplication, throttling, locking, and observability."),
    bullet("<b>Container health is not service health.</b> PostgREST was running while real queries returned HTTP 503."),
    bullet("<b>Concurrency testing is essential.</b> Single-client tests did not expose cross-tab and cross-workstation amplification."),
    bullet("<b>Narrow recovery reduces risk.</b> Restarting only PostgREST preserved healthy database, Auth, and Storage services."),
]

story += [p("13. Evidence and Change References", "H1X")]
references = [
    [p("Reference", "THX"), p("Details", "THX")],
    [p("Triggering commit", "TBX"), p("0a107c6d776a7201ffe7f9791dec550ef9e479e0 - Batch automatic ONP patient updates", "TCX")],
    [p("Corrective commit", "TBX"), p("1b7bc4deee0b97c37719e402cf37d62e4cf42757 - Prevent concurrent automatic ONP refresh storms", "TCX")],
    [p("Production error", "TBX"), p("PGRST003 pool acquisition timeout followed by PGRST002 schema-cache failure.", "TCX")],
    [p("Migration", "TBX"), p("supabase/migrations/20260921000000_atomic_auto_onp_refresh.sql", "TCX")],
    [p("Client correction", "TBX"), p("services/api.ts - RPC path, compatibility fallback, single-flight, and cooldown.", "TCX")],
    [p("Regression tests", "TBX"), p("services/api.autoOnpBatching.test.ts and atomic_auto_onp_refresh.test.ts", "TCX")],
    [p("Recovery backup", "TBX"), p("/root/supabase-backups/postgres-pre-rest-restart-20260921-110432.dump", "TCX")],
]
story += [grid(references, [40 * mm, 115 * mm])]

story += [p("14. Final Status", "H1X")]
final = [
    [p("Item", "THX"), p("Status", "THX")],
    [p("Client-facing REST service restored", "TCX"), p("Complete", "GoodX")],
    [p("Database protected by pre-change backup", "TCX"), p("Complete", "GoodX")],
    [p("Atomic production migration deployed", "TCX"), p("Complete", "GoodX")],
    [p("Corrective code pushed to origin/main", "TCX"), p("Complete", "GoodX")],
    [p("Automatic recovery watchdog active", "TCX"), p("Complete", "GoodX")],
    [p("Post-remediation concurrency validation", "TCX"), p("Complete", "GoodX")],
]
story += [grid(final, [115 * mm, 40 * mm]), Spacer(1, 8 * mm), HRFlowable(width="100%", thickness=0.7, color=LIGHT), Spacer(1, 4 * mm)]
story += [p("<b>Report limitation:</b> This document reflects evidence available during the live incident response and validation window. It does not replace a forensic disk image, long-duration load test, disaster-recovery exercise, or independent security audit.", "SmallX")]

document = SimpleDocTemplate(
    str(OUT),
    pagesize=A4,
    rightMargin=18 * mm,
    leftMargin=18 * mm,
    topMargin=18 * mm,
    bottomMargin=22 * mm,
    title="DentalCloud Production Incident Report",
    author="DentalCloud Engineering",
    subject="PostgREST connection pool exhaustion and automatic ONP request amplification",
)
document.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)