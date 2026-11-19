"""Tests for discovery services using small synthetic event logs."""
import pytest

try:
    import pm4py
    PM4PY_AVAILABLE = True
except ImportError:
    PM4PY_AVAILABLE = False

pytestmark = pytest.mark.skipif(not PM4PY_AVAILABLE, reason="pm4py not installed")


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def simple_log(tmp_path):
    """Create a minimal pm4py EventLog from a small synthetic CSV."""
    import pandas as pd
    import pm4py

    rows = [
        ("c1", "CreateOrder", "2024-01-01 09:00:00"),
        ("c1", "ApproveOrder", "2024-01-01 10:00:00"),
        ("c1", "ShipOrder", "2024-01-01 11:00:00"),
        ("c1", "CloseOrder", "2024-01-01 12:00:00"),
        ("c2", "CreateOrder", "2024-01-02 09:00:00"),
        ("c2", "ApproveOrder", "2024-01-02 10:30:00"),
        ("c2", "CloseOrder", "2024-01-02 11:00:00"),
        ("c3", "CreateOrder", "2024-01-03 08:00:00"),
        ("c3", "ShipOrder", "2024-01-03 09:00:00"),
        ("c3", "CloseOrder", "2024-01-03 10:00:00"),
    ]
    df = pd.DataFrame(rows, columns=["case:concept:name", "concept:name", "time:timestamp"])
    df = pm4py.format_dataframe(df, case_id="case:concept:name",
                                activity_key="concept:name",
                                timestamp_key="time:timestamp")
    return pm4py.convert_to_event_log(df)


# ── DFG ───────────────────────────────────────────────────────────────────────

class TestDFGDiscovery:
    def test_discover_dfg_returns_dfg_graph(self, simple_log):
        from app.models.graph import DFGGraph
        from app.services.discovery.dfg import discover_dfg

        result = discover_dfg(simple_log)
        assert isinstance(result, DFGGraph)
        assert result.kind == "dfg"

    def test_discover_dfg_has_activities(self, simple_log):
        from app.services.discovery.dfg import discover_dfg

        result = discover_dfg(simple_log)
        activity_labels = {a.label for a in result.activities}
        assert "CreateOrder" in activity_labels
        assert "CloseOrder" in activity_labels

    def test_discover_dfg_has_edges(self, simple_log):
        from app.services.discovery.dfg import discover_dfg

        result = discover_dfg(simple_log)
        assert len(result.edges) > 0

    def test_discover_dfg_start_activities(self, simple_log):
        from app.services.discovery.dfg import discover_dfg

        result = discover_dfg(simple_log)
        assert len(result.startActivities) > 0

    def test_discover_dfg_custom_id(self, simple_log):
        from app.services.discovery.dfg import discover_dfg

        result = discover_dfg(simple_log, graph_id="test-id-123")
        assert result.id == "test-id-123"

    def test_discover_dfg_custom_name(self, simple_log):
        from app.services.discovery.dfg import discover_dfg

        result = discover_dfg(simple_log, graph_name="My DFG")
        assert result.name == "My DFG"


# ── Petri Net ─────────────────────────────────────────────────────────────────

class TestPetriNetDiscovery:
    def test_discover_petri_net_inductive(self, simple_log):
        from app.models.graph import PetriNetGraph
        from app.services.discovery.petri_net import discover_petri_net

        result = discover_petri_net(simple_log, algorithm="inductive")
        assert isinstance(result, PetriNetGraph)
        assert result.kind == "petri_net"
        assert len(result.places) > 0
        assert len(result.transitions) > 0
        assert len(result.arcs) > 0

    def test_discover_petri_net_alpha(self, simple_log):
        from app.models.graph import PetriNetGraph
        from app.services.discovery.petri_net import discover_petri_net

        result = discover_petri_net(simple_log, algorithm="alpha")
        assert isinstance(result, PetriNetGraph)

    def test_discover_petri_net_heuristics(self, simple_log):
        from app.models.graph import PetriNetGraph
        from app.services.discovery.petri_net import discover_petri_net

        result = discover_petri_net(simple_log, algorithm="heuristics")
        assert isinstance(result, PetriNetGraph)

    def test_places_have_ids(self, simple_log):
        from app.services.discovery.petri_net import discover_petri_net

        result = discover_petri_net(simple_log)
        for place in result.places:
            assert place.id
            assert isinstance(place.initialTokens, int)


# ── Process Tree ──────────────────────────────────────────────────────────────

class TestProcessTreeDiscovery:
    def test_discover_process_tree_returns_graph(self, simple_log):
        from app.models.graph import ProcessTreeGraph
        from app.services.discovery.process_tree import discover_process_tree

        result = discover_process_tree(simple_log)
        assert isinstance(result, ProcessTreeGraph)
        assert result.kind == "process_tree"

    def test_process_tree_has_root(self, simple_log):
        from app.services.discovery.process_tree import discover_process_tree

        result = discover_process_tree(simple_log)
        assert result.root is not None
        assert result.root.id is not None
        assert result.root.type in ("operator", "activity", "tau")

    def test_process_tree_root_type(self, simple_log):
        """Root of a non-trivial log should be an operator node."""
        from app.services.discovery.process_tree import discover_process_tree

        result = discover_process_tree(simple_log)
        # Root should be an operator (seq/xor/and/loop) for a multi-activity log
        assert result.root.type == "operator"


# ── BPMN ─────────────────────────────────────────────────────────────────────

class TestBPMNDiscovery:
    def test_discover_bpmn_returns_graph(self, simple_log):
        from app.models.graph import BPMNGraph
        from app.services.discovery.bpmn_discovery import discover_bpmn

        result = discover_bpmn(simple_log)
        assert isinstance(result, BPMNGraph)
        assert result.kind == "bpmn"

    def test_bpmn_has_nodes(self, simple_log):
        from app.services.discovery.bpmn_discovery import discover_bpmn

        result = discover_bpmn(simple_log)
        assert len(result.nodes) > 0

    def test_bpmn_node_types(self, simple_log):
        from app.services.discovery.bpmn_discovery import discover_bpmn

        valid_types = {
            "startEvent", "endEvent", "intermediateEvent",
            "task", "xorGateway", "andGateway", "orGateway",
        }
        result = discover_bpmn(simple_log)
        for node in result.nodes:
            assert node.type in valid_types
