from __future__ import annotations

import json

import pytest

from osc_surface_ui.manifest import ManifestError, parse_manifest

VALID = {
    "version": 1,
    "projectId": "osc-surface-demo",
    "entries": [
        {
            "address": "/avatar/blend/smile",
            "label": "Smile",
            "type": "f",
            "widget": "fader",
            "range": [0, 1],
            "default": 0.35,
            "group": "Face",
        },
        {
            "address": "/avatar/toggle/visible",
            "label": "Visible",
            "type": "bool",
            "widget": "toggle",
            "default": True,
        },
    ],
}


def test_parses_json_string_and_dict_alike() -> None:
    from_dict = parse_manifest(VALID)
    from_json = parse_manifest(json.dumps(VALID))

    assert from_dict == from_json
    assert from_dict.project_id == "osc-surface-demo"
    assert len(from_dict.entries) == 2


def test_keeps_optional_fields_absent_instead_of_null() -> None:
    manifest = parse_manifest(VALID)
    smile, visible = manifest.entries

    assert smile.value_range == (0.0, 1.0)
    assert smile.group == "Face"
    assert smile.has_default is True
    assert visible.value_range is None
    assert visible.group is None
    assert visible.default is True


def test_bool_entries_are_sent_as_int_type_tag() -> None:
    manifest = parse_manifest(VALID)

    assert manifest.entries[1].type_tag == "i"
    assert manifest.entries[0].type_tag == "f"


def test_groups_keep_manifest_order_and_put_ungrouped_first() -> None:
    manifest = parse_manifest(
        {
            "version": 1,
            "projectId": "p",
            "entries": [
                {"address": "/a", "label": "a", "type": "f", "widget": "fader"},
                {"address": "/b", "label": "b", "type": "f", "widget": "fader", "group": "Z"},
                {"address": "/c", "label": "c", "type": "f", "widget": "fader", "group": "A"},
                {"address": "/d", "label": "d", "type": "f", "widget": "fader", "group": "Z"},
            ],
        }
    )

    groups = manifest.groups()

    assert [name for name, _ in groups] == [None, "Z", "A"]
    assert [entry.address for entry in groups[1][1]] == ["/b", "/d"]


def test_clamp_uses_declared_range() -> None:
    entry = parse_manifest(VALID).entries[0]

    assert entry.clamp(2.0) == 1.0
    assert entry.clamp(-1.0) == 0.0
    assert entry.clamp(0.5) == 0.5


@pytest.mark.parametrize(
    "mutation",
    [
        {"version": 2},
        {"projectId": ""},
        {"entries": "nope"},
    ],
)
def test_rejects_broken_root(mutation: dict) -> None:
    with pytest.raises(ManifestError):
        parse_manifest({**VALID, **mutation})


@pytest.mark.parametrize(
    "entry",
    [
        {"address": "avatar", "label": "a", "type": "f", "widget": "fader"},
        {"address": "/a", "label": "a", "type": "x", "widget": "fader"},
        {"address": "/a", "label": "a", "type": "f", "widget": "dial"},
        {"address": "/a", "label": "a", "type": "f", "widget": "fader", "range": [0]},
        {"address": "/a", "label": "a", "type": "f", "widget": "fader", "range": "0,1"},
        {"address": "/a", "label": 1, "type": "f", "widget": "fader"},
        {"address": "/a", "label": "a", "type": "f", "widget": "fader", "group": 3},
    ],
)
def test_rejects_broken_entry(entry: dict) -> None:
    with pytest.raises(ManifestError):
        parse_manifest({"version": 1, "projectId": "p", "entries": [entry]})


def test_rejects_non_json_payload() -> None:
    with pytest.raises(ManifestError):
        parse_manifest("{not json")
