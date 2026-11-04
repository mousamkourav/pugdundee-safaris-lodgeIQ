"use client";

// The editor (TipTap) and the Word importer are large: they load only when the super admin opens
// them, so staff reading the SOP on a phone never download them.
import dynamic from "next/dynamic";

const Loading = () => <p className="text-sm text-sand-500">Loading...</p>;

export const SopEditMode = dynamic(() => import("./edit-mode").then((m) => m.SopEditMode), { loading: Loading });
export const Importer = dynamic(() => import("./importer").then((m) => m.Importer), { loading: Loading });
