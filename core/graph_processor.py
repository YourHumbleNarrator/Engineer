"""
graph_processor.py
~~~~~~~~~~~~~~~~~~
Graph reduction and filtering pipeline.

Reduction algorithms (to be implemented):
  - ReductionAlgorithm.FREQUENCY_THRESHOLD  – remove low-frequency edges/nodes
  - ReductionAlgorithm.TOPOLOGY             – structural simplification (e.g. series/parallel merging)
  - ReductionAlgorithm.CLUSTERING           – community-based coarsening

Filtering:
  - by edge/node frequency (absolute count or percentile)
  - by arbitrary node/edge attributes (equality, range, regex, membership)
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any

import networkx as nx


# ---------------------------------------------------------------------------
# Public enumerations
# ---------------------------------------------------------------------------

class ReductionAlgorithm(Enum):
    FREQUENCY_THRESHOLD = auto()   # keep only edges/nodes above a frequency cut-off
    TOPOLOGY = auto()   # collapse series/parallel subgraphs
    CLUSTERING = auto()   # merge nodes into super-nodes by community


class FilterOp(Enum):
    """Comparison operators available for attribute filters."""
    EQ = "eq"       # ==
    NEQ = "neq"      # !=
    LT = "lt"       # <
    LTE = "lte"      # <=
    GT = "gt"       # >
    GTE = "gte"      # >=
    IN = "in"       # value in list
    NOT_IN = "not_in"   # value not in list
    REGEX = "regex"    # re.search(pattern, str(value))
    EXISTS = "exists"   # attribute key is present


# ---------------------------------------------------------------------------
# Configuration dataclasses
# ---------------------------------------------------------------------------

@dataclass
class FrequencyFilter:
    """
    Keep nodes and/or edges whose frequency attribute meets the threshold.

    Attributes
    ----------
    min_frequency:
        Absolute lower bound (inclusive).  Set to None to skip.
    max_frequency:
        Absolute upper bound (inclusive).  Set to None to skip.
    percentile_min:
        Keep elements at or above this frequency percentile (0–100).
        Applied *after* min_frequency / max_frequency if both are given.
    frequency_attr:
        Name of the numeric attribute that holds the frequency value.
    apply_to_nodes:
        Whether to filter nodes.
    apply_to_edges:
        Whether to filter edges.
    remove_orphans:
        After edge filtering, remove nodes that have no remaining edges.
    """
    min_frequency:   float | None = None
    max_frequency:   float | None = None
    percentile_min:  float | None = None   # e.g. 25.0 → bottom quarter removed
    frequency_attr:  str = "frequency"
    apply_to_nodes:  bool = True
    apply_to_edges:  bool = True
    remove_orphans:  bool = True


@dataclass
class AttributeFilter:
    """
    A single predicate applied to a node or edge attribute.

    Example
    -------
    AttributeFilter(target="edge", key="label", op=FilterOp.REGEX, value=r"^place_")
    """
    target: str       # "node" or "edge"
    key:    str       # attribute name
    op:     FilterOp  # comparison operator
    value:  Any = None  # rhs; unused when op == FilterOp.EXISTS


@dataclass
class ReductionConfig:
    """
    Parameters forwarded to the chosen reduction algorithm.

    Each algorithm reads only the keys it recognises; unknown keys are ignored,
    so a single config object can be shared across algorithms without conflict.

    Common keys used by the built-in stubs:
      frequency_threshold (float) – used by FREQUENCY_THRESHOLD
      merge_threshold     (float) – used by TOPOLOGY / CLUSTERING
      max_nodes           (int)   – hard cap after reduction
    """
    algorithm: ReductionAlgorithm
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProcessorConfig:
    """
    Top-level configuration for :func:`process_graph`.

    Fields
    ------
    frequency_filter:
        Optional frequency-based filter applied first.
    attribute_filters:
        Zero or more attribute predicates; all must pass (AND semantics).
        Pass multiple :class:`AttributeFilter` objects for compound queries.
    reduction:
        Optional reduction step applied after filtering.
    copy_graph:
        If True (default), work on a deep copy so the original is untouched.
    """
    frequency_filter:   FrequencyFilter | None = None
    attribute_filters:  list[AttributeFilter] = field(default_factory=list)
    reduction:          ReductionConfig | None = None
    copy_graph:         bool = True


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_frequencies(graph: nx.Graph, attr: str, target: str) -> list[float]:
    """Return all frequency values present in the graph for nodes or edges."""
    if target == "node":
        return [d.get(attr, 0) for _, d in graph.nodes(data=True)]
    return [d.get(attr, 0) for _, _, d in graph.edges(data=True)]


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    idx = int(len(sorted_vals) * pct / 100)
    return sorted_vals[min(idx, len(sorted_vals) - 1)]


def _passes_frequency(value: float, cfg: FrequencyFilter) -> bool:
    if cfg.min_frequency is not None and value < cfg.min_frequency:
        return False
    if cfg.max_frequency is not None and value > cfg.max_frequency:
        return False
    return True


def _eval_op(attr_value: Any, op: FilterOp, rhs: Any) -> bool:
    """Evaluate a single FilterOp predicate."""
    match op:
        case FilterOp.EQ: return attr_value == rhs
        case FilterOp.NEQ: return attr_value != rhs
        case FilterOp.LT: return attr_value < rhs
        case FilterOp.LTE: return attr_value <= rhs
        case FilterOp.GT: return attr_value > rhs
        case FilterOp.GTE: return attr_value >= rhs
        case FilterOp.IN: return attr_value in rhs
        case FilterOp.NOT_IN: return attr_value not in rhs
        case FilterOp.REGEX: return bool(re.search(rhs, str(attr_value)))
        case FilterOp.EXISTS: return True   # key existence already checked
        case _:
            raise ValueError(f"Unknown FilterOp: {op}")


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------

def apply_frequency_filter(graph: nx.Graph, cfg: FrequencyFilter) -> nx.Graph:
    """
    Remove nodes and/or edges that fall below (or above) the frequency bounds.

    Returns the mutated graph (operates in-place on whatever is passed in).
    """
    # Resolve percentile-based lower bound
    effective_min = cfg.min_frequency

    if cfg.percentile_min is not None:
        targets = []
        if cfg.apply_to_nodes:
            targets += _get_frequencies(graph, cfg.frequency_attr, "node")
        if cfg.apply_to_edges:
            targets += _get_frequencies(graph, cfg.frequency_attr, "edge")
        pct_bound = _percentile(targets, cfg.percentile_min)
        effective_min = max(effective_min or 0.0, pct_bound)

    # --- Edge filtering ---
    if cfg.apply_to_edges:
        remove_edges = [
            (u, v)
            for u, v, d in graph.edges(data=True)
            if not _passes_frequency(
                d.get(cfg.frequency_attr, 0),
                FrequencyFilter(
                    min_frequency=effective_min,
                    max_frequency=cfg.max_frequency,
                    frequency_attr=cfg.frequency_attr,
                ),
            )
        ]
        graph.remove_edges_from(remove_edges)

    # --- Node filtering ---
    if cfg.apply_to_nodes:
        remove_nodes = [
            n
            for n, d in graph.nodes(data=True)
            if not _passes_frequency(
                d.get(cfg.frequency_attr, 0),
                FrequencyFilter(
                    min_frequency=effective_min,
                    max_frequency=cfg.max_frequency,
                    frequency_attr=cfg.frequency_attr,
                ),
            )
        ]
        graph.remove_nodes_from(remove_nodes)

    # --- Orphan cleanup ---
    if cfg.remove_orphans:
        orphans = [n for n in graph.nodes() if graph.degree(n) == 0]
        graph.remove_nodes_from(orphans)

    return graph


def apply_attribute_filters(
    graph: nx.Graph,
    filters: list[AttributeFilter],
) -> nx.Graph:
    """
    Remove nodes/edges that fail *any* of the given attribute predicates.

    All filters are combined with AND semantics: an element is kept only when
    every applicable predicate returns True.
    """
    node_filters = [f for f in filters if f.target == "node"]
    edge_filters = [f for f in filters if f.target == "edge"]

    # --- Apply node filters ---
    if node_filters:
        remove_nodes = []
        for node, data in graph.nodes(data=True):
            for af in node_filters:
                if af.op == FilterOp.EXISTS:
                    passes = af.key in data
                else:
                    if af.key not in data:
                        passes = False
                    else:
                        passes = _eval_op(data[af.key], af.op, af.value)
                if not passes:
                    remove_nodes.append(node)
                    break
        graph.remove_nodes_from(remove_nodes)

    # --- Apply edge filters ---
    if edge_filters:
        remove_edges = []
        for u, v, data in graph.edges(data=True):
            for af in edge_filters:
                if af.op == FilterOp.EXISTS:
                    passes = af.key in data
                else:
                    if af.key not in data:
                        passes = False
                    else:
                        passes = _eval_op(data[af.key], af.op, af.value)
                if not passes:
                    remove_edges.append((u, v))
                    break
        graph.remove_edges_from(remove_edges)

    return graph


# ---------------------------------------------------------------------------
# Reduction algorithm stubs
# ---------------------------------------------------------------------------

class _BaseReduction(ABC):
    """All reduction algorithms implement this interface."""

    @abstractmethod
    def reduce(self, graph: nx.Graph, params: dict[str, Any]) -> nx.Graph:
        """
        Simplify *graph* according to *params* and return the result.

        The returned graph may be the same object (mutated in-place) or a new
        NetworkX graph — callers must not assume either.
        """


class _FrequencyThresholdReduction(_BaseReduction):
    """
    Remove the lowest-frequency edges until the graph reaches a target size or
    a minimum edge frequency is met.

    Expected params
    ---------------
    frequency_threshold : float
        Edges with frequency < this value are removed first (ascending order).
    max_nodes : int, optional
        If given, keep removing until node count ≤ max_nodes.
    frequency_attr : str, default "frequency"
        Edge attribute used as the frequency proxy.
    """

    def reduce(self, graph: nx.Graph, params: dict[str, Any]) -> nx.Graph:
        # TODO: implement frequency-threshold reduction
        raise NotImplementedError(
            "FrequencyThresholdReduction.reduce() is not yet implemented. "
            "Fill in this method in graph_processor.py."
        )


class _TopologyReduction(_BaseReduction):
    """
    Structural simplification: collapse series edges (A→B→C with B degree-2
    becomes A→C) and optionally parallel edges.

    Expected params
    ---------------
    merge_threshold : float, optional
        Minimum combined frequency to retain a merged edge.
    preserve_labels : bool, default True
        If True, concatenate labels of merged edges; if False, discard them.
    collapse_parallel : bool, default False
        Also merge multi-edges between the same pair of nodes.
    """

    def reduce(self, graph: nx.Graph, params: dict[str, Any]) -> nx.Graph:
        # TODO: implement topology reduction
        raise NotImplementedError(
            "TopologyReduction.reduce() is not yet implemented. "
            "Fill in this method in graph_processor.py."
        )


class _ClusteringReduction(_BaseReduction):
    """
    Community-based coarsening: detect communities and replace each with a
    single super-node; inter-community edges become edges between super-nodes.

    Expected params
    ---------------
    merge_threshold : float, optional
        Minimum edge weight between communities to keep the inter-community edge.
    community_attr : str, default "community"
        Node attribute to use as a pre-computed community label.
        If the attribute is absent, run a detection algorithm automatically.
    algorithm : str, default "louvain"
        Community-detection algorithm to use when labels are absent.
        Supported: "louvain", "label_propagation", "greedy_modularity".
    """

    def reduce(self, graph: nx.Graph, params: dict[str, Any]) -> nx.Graph:
        # TODO: implement clustering reduction
        raise NotImplementedError(
            "ClusteringReduction.reduce() is not yet implemented. "
            "Fill in this method in graph_processor.py."
        )


_REDUCTION_REGISTRY: dict[ReductionAlgorithm, _BaseReduction] = {
    ReductionAlgorithm.FREQUENCY_THRESHOLD: _FrequencyThresholdReduction(),
    ReductionAlgorithm.TOPOLOGY:            _TopologyReduction(),
    ReductionAlgorithm.CLUSTERING:          _ClusteringReduction(),
}


def apply_reduction(graph: nx.Graph, cfg: ReductionConfig) -> nx.Graph:
    """Dispatch to the chosen reduction algorithm."""
    reducer = _REDUCTION_REGISTRY.get(cfg.algorithm)
    if reducer is None:
        raise ValueError(f"Unknown reduction algorithm: {cfg.algorithm}")
    return reducer.reduce(graph, cfg.params)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def process_graph(graph: nx.Graph, config: ProcessorConfig) -> nx.Graph:
    """
    Apply the full reduction/filtering pipeline to *graph*.

    Pipeline order
    --------------
    1. (optional) frequency filter  – coarse removal by numeric frequency
    2. (optional) attribute filters – fine-grained predicate filtering
    3. (optional) reduction         – structural / algorithmic simplification

    Parameters
    ----------
    graph:
        Any NetworkX graph (Graph, DiGraph, MultiGraph, MultiDiGraph).
    config:
        Pipeline configuration.  See :class:`ProcessorConfig`.

    Returns
    -------
    nx.Graph
        The processed graph.  A deep copy is returned when
        ``config.copy_graph`` is True (the default), leaving the original
        graph untouched.
    """
    if config.copy_graph:
        graph = graph.copy()

    if config.frequency_filter is not None:
        graph = apply_frequency_filter(graph, config.frequency_filter)

    if config.attribute_filters:
        graph = apply_attribute_filters(graph, config.attribute_filters)

    if config.reduction is not None:
        graph = apply_reduction(graph, config.reduction)

    return graph
