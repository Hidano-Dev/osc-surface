using System;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(menuName = "OSC Surface/Manifest Asset", fileName = "OscSurfaceManifest")]
public sealed class OscSurfaceManifestAsset : ScriptableObject
{
    public string projectId = "";
    public List<Entry> entries = new List<Entry>();

    public enum EntryType
    {
        Int,
        Float,
        String,
        Blob,
        Bool,
    }

    public enum WidgetType
    {
        Fader,
        Button,
        Toggle,
        Xy,
        Text,
    }

    public enum DefaultKind
    {
        None,
        Int,
        Float,
        String,
        Bool,
    }

    [Serializable]
    public sealed class Entry
    {
        public string address = "";
        public string label = "";
        public EntryType type;
        public WidgetType widget;
        public bool hasRange;
        public float rangeMin;
        public float rangeMax;
        public DefaultKind defaultKind;
        public int defaultInt;
        public float defaultFloat;
        public string defaultString = "";
        public bool defaultBool;
        public string group = "";
    }
}
