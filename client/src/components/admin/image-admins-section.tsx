import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Image as ImageIcon, UserPlus, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ImageAdminActivity from "./image-admin-activity";

interface ImageAdminSummary {
  id: number;
  username: string;
  displayName?: string | null;
  isAdmin: boolean;
  imageAdmin: boolean;
  cardsEdited: number;
  totalEdits: number;
  lastEditAt?: string | null;
}

export default function ImageAdminsSection() {
  const [username, setUsername] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: imageAdmins = [], isLoading, isError, refetch } = useQuery<ImageAdminSummary[]>({
    queryKey: ["/api/admin/image-admins"],
    queryFn: () => apiRequest("GET", "/api/admin/image-admins").then(res => res.json()),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/image-admins"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
  };
  const add = useMutation({
    mutationFn: (username: string) => apiRequest("POST", "/api/admin/image-admins", { username }),
    onSuccess: () => {
      setUsername("");
      refresh();
      toast({ title: "Image Admin access granted" });
    },
    onError: (error: Error) => toast({ title: "Could not add Image Admin", description: error.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/image-admins/${id}`),
    onSuccess: () => {
      refresh();
      toast({ title: "Image Admin access removed" });
    },
    onError: (error: Error) => toast({ title: "Could not remove Image Admin", description: error.message, variant: "destructive" }),
  });
  return (
    <section className="bg-white rounded-lg border border-gray-200 overflow-hidden" aria-label="Image Admins">
      <div className="p-5 border-b border-gray-200">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-50 p-2"><ImageIcon className="w-5 h-5 text-blue-700" /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Image Admins</h2>
            <p className="text-sm text-gray-600">Grant image-only card editing access and track successful Cloudinary image updates.</p>
            <form className="flex flex-col sm:flex-row gap-2 mt-4 max-w-xl" onSubmit={event => {
              event.preventDefault();
              if (username.trim()) add.mutate(username.trim());
            }}>
              <Input value={username} onChange={event => setUsername(event.target.value)}
                placeholder="Enter an exact username" aria-label="Image Admin username" className="bg-white" />
              <Button type="submit" disabled={!username.trim() || add.isPending} className="bg-blue-700 hover:bg-blue-800 whitespace-nowrap">
                <UserPlus className="w-4 h-4 mr-2" />Add Image Admin
              </Button>
            </form>
          </div>
        </div>
      </div>
      {isError ? (
        <div role="alert" className="p-5 text-gray-900">
          Could not load Image Admins. <Button variant="outline" onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>{["User", "Access", "Cards Edited", "Total Updates", "Last Update", "Action"].map(label => (
                  <th key={label} scope="col" className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {isLoading ? <tr><td colSpan={6} className="px-5 py-4 text-sm text-gray-500 text-center">Loading Image Admins…</td></tr>
                  : imageAdmins.length === 0 ? <tr><td colSpan={6} className="px-5 py-4 text-sm text-gray-500 text-center">No Image Admins yet.</td></tr>
                  : imageAdmins.map(editor => (
                    <tr key={editor.id}>
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-gray-900">{editor.username}</p>
                        {editor.displayName && <p className="text-xs text-gray-500">{editor.displayName}</p>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge className={editor.isAdmin ? "bg-red-600 text-white" : editor.imageAdmin ? "bg-blue-100 text-blue-800 border-blue-200" : "bg-gray-100 text-gray-700 border-gray-200"}>
                          {editor.isAdmin ? "True Admin" : editor.imageAdmin ? "Image Admin" : "Former Image Admin"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-gray-900">{editor.cardsEdited}</td>
                      <td className="px-5 py-3 text-sm text-gray-700">{editor.totalEdits}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{editor.lastEditAt ? new Date(editor.lastEditAt).toLocaleString() : "—"}</td>
                      <td className="px-5 py-3 text-right">
                        {editor.imageAdmin && <Button variant="outline" size="sm" onClick={() => remove.mutate(editor.id)} disabled={remove.isPending}>
                          <X className="w-4 h-4 mr-1" />Remove
                        </Button>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <ImageAdminActivity imageAdmins={imageAdmins} isLoading={isLoading} />
        </>
      )}
    </section>
  );
}
