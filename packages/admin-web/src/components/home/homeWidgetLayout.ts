import type {
  SharedDashboardResponse,
  SharedDashboardWidgetLayout,
  SharedDashboardWidgetLayoutItem,
  SharedDashboardWidgetPreference,
  SharedDashboardWidgetSummary
} from "../../jobTruthTypes";

export type HomeWidgetDraftItem = {
  widget_key: string;
  is_visible: boolean;
};

export function buildWidgetLayoutMap(layout: SharedDashboardWidgetLayout): Map<string, SharedDashboardWidgetLayoutItem> {
  return new Map(layout.items.map((item) => [item.widget_key, item]));
}

export function buildHomeWidgetDraft(
  widgets: SharedDashboardWidgetSummary[],
  preferences: SharedDashboardWidgetPreference[],
  layout: SharedDashboardWidgetLayout
): HomeWidgetDraftItem[] {
  const layoutMap = buildWidgetLayoutMap(layout);
  const widgetMap = new Map(widgets.map((widget) => [widget.widget_key, widget]));
  const baseOrder = [
    ...layout.items.map((item) => item.widget_key),
    ...widgets.filter((widget) => !layoutMap.has(widget.widget_key)).map((widget) => widget.widget_key)
  ].filter((widget_key, index, all) => widgetMap.has(widget_key) && all.indexOf(widget_key) === index);

  const preferenceMap = new Map(preferences.map((item) => [item.widget_key, item]));
  const orderedKeys = preferences.length
    ? [
        ...preferences.map((item) => item.widget_key).filter((widget_key, index, all) => widgetMap.has(widget_key) && all.indexOf(widget_key) === index),
        ...baseOrder.filter((widget_key) => !preferenceMap.has(widget_key))
      ]
    : baseOrder;

  return orderedKeys.map((widget_key) => {
    const rules = layoutMap.get(widget_key);
    return {
      widget_key,
      is_visible: rules?.required ? true : preferenceMap.get(widget_key)?.is_visible ?? rules?.default_visible ?? true
    };
  });
}

export function applyHomeWidgetDraft(widgets: SharedDashboardWidgetSummary[], draft: HomeWidgetDraftItem[]) {
  if (!draft.length) {
    return widgets;
  }
  const widgetMap = new Map(widgets.map((widget) => [widget.widget_key, widget]));
  return draft.flatMap((item) => {
    if (!item.is_visible) {
      return [];
    }
    const widget = widgetMap.get(item.widget_key);
    return widget ? [widget] : [];
  });
}

export function moveHomeWidgetDraftItem(draft: HomeWidgetDraftItem[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= draft.length) {
    return draft;
  }
  const next = [...draft];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function reorderHomeWidgetDraft(draft: HomeWidgetDraftItem[], draggedKey: string, targetKey: string) {
  if (!draggedKey || draggedKey === targetKey) {
    return draft;
  }
  const sourceIndex = draft.findIndex((item) => item.widget_key === draggedKey);
  const targetIndex = draft.findIndex((item) => item.widget_key === targetKey);
  if (sourceIndex < 0 || targetIndex < 0) {
    return draft;
  }
  const next = [...draft];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

export function getRoleLayoutSummary(layout: SharedDashboardResponse["widget_layout"]) {
  const requiredCount = layout.items.filter((item) => item.required).length;
  const optionalCount = layout.items.length - requiredCount;
  return {
    requiredCount,
    optionalCount,
    roleLabel: layout.role_key.replace(/_/g, " ")
  };
}
