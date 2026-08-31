export const ACTIVITY_LABELS: Record<string, string> = {
  viewed_project: "Opened the project",
  viewed_render: "Viewed a render",
  viewed_drawing: "Viewed a drawing",
  downloaded_drawing: "Downloaded a drawing",
  downloaded_document: "Downloaded a document",
  downloaded_image: "Downloaded an image",
  downloaded_package: "Downloaded the full project package",
  viewed_boq: "Viewed the BOQ",
  viewed_pricing: "Viewed pricing",
  approved: "Approved a design",
  requested_changes: "Requested changes",
  commented: "Left a comment",
  sent_to_client: "Project link sent to client (WhatsApp)",
  sent_update: "Client notified of an update (WhatsApp)",
};

export function activityLabel(type: string) {
  return ACTIVITY_LABELS[type] ?? type;
}
