import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Edit, Trash2, UserPlus, Shield, User } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
  plan: string;
  createdAt: string;
  lastLogin?: string;
}

export default function AdminUsers() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['/api/admin/users'],
    queryFn: async () => {
      const response = await fetch('/api/admin/users');
      if (!response.ok) throw new Error('Failed to fetch users');
      return response.json();
    }
  });

  const createUserMutation = useMutation({
    mutationFn: async (userData: { username: string; email: string; password: string; isAdmin: boolean; plan: string }) => {
      return apiRequest('POST', '/api/admin/users', userData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: "User created successfully" });
      setIsCreateOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to create user", variant: "destructive" });
    }
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, ...userData }: { id: number; username: string; email: string; isAdmin: boolean; plan: string }) => {
      return apiRequest('PATCH', `/api/admin/users/${id}`, userData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: "User updated successfully" });
      setIsEditOpen(false);
      setSelectedUser(null);
    },
    onError: () => {
      toast({ title: "Failed to update user", variant: "destructive" });
    }
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/admin/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: "User deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete user", variant: "destructive" });
    }
  });

  const handleDeleteUser = (user: User) => {
    if (confirm(`Are you sure you want to delete user "${user.username}"? This action cannot be undone.`)) {
      deleteUserMutation.mutate(user.id);
    }
  };

  const filteredUsers = users.filter((user: User) => 
    user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900">User Management</h1>
          <p className="text-gray-600">Manage user accounts, permissions, and plans</p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-marvel-red hover:bg-red-700">
              <UserPlus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
            </DialogHeader>
            <CreateUserForm onSubmit={createUserMutation.mutate} isLoading={createUserMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search users by username or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-white"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Login</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                    Loading users...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                    No users found
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user: User) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center mr-3">
                          <User className="w-4 h-4 text-gray-500" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{user.username}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.isAdmin ? (
                        <Badge className="bg-red-100 text-red-800">
                          <Shield className="w-3 h-3 mr-1" />
                          Admin
                        </Badge>
                      ) : (
                        <Badge variant="outline">User</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant="secondary">{user.plan}</Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedUser(user);
                            setIsEditOpen(true);
                          }}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteUser(user)}
                          disabled={deleteUserMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit User Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <EditUserForm 
              user={selectedUser} 
              onSubmit={(data) => updateUserMutation.mutate({ id: selectedUser.id, ...data })}
              isLoading={updateUserMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateUserForm({ onSubmit, isLoading }: { onSubmit: (data: any) => void; isLoading: boolean }) {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    isAdmin: false,
    plan: 'free'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          value={formData.username}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          required
          className="bg-white"
        />
      </div>

      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          required
          className="bg-white"
        />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          required
          className="bg-white"
        />
      </div>

      <div>
        <Label htmlFor="plan">Plan</Label>
        <Select value={formData.plan} onValueChange={(value) => setFormData({ ...formData, plan: value })}>
          <SelectTrigger className="bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="premium">Premium</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="isAdmin"
          checked={formData.isAdmin}
          onCheckedChange={(checked) => setFormData({ ...formData, isAdmin: checked })}
        />
        <Label htmlFor="isAdmin">Admin privileges</Label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading} className="bg-marvel-red hover:bg-red-700">
          Create User
        </Button>
      </div>
    </form>
  );
}

function EditUserForm({ user, onSubmit, isLoading }: { user: User; onSubmit: (data: any) => void; isLoading: boolean }) {
  const [formData, setFormData] = useState({
    username: user.username,
    email: user.email,
    isAdmin: user.isAdmin,
    plan: user.plan
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="username" className="text-black">Username</Label>
        <Input
          id="username"
          value={formData.username}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          required
          className="bg-white text-black"
        />
      </div>

      <div>
        <Label htmlFor="email" className="text-black">Email</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          required
          className="bg-white text-black"
        />
      </div>

      <div>
        <Label htmlFor="plan" className="text-black">Plan</Label>
        <Select value={formData.plan} onValueChange={(value) => setFormData({ ...formData, plan: value })}>
          <SelectTrigger className="bg-white text-black">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SIDE_KICK">SIDE KICK</SelectItem>
            <SelectItem value="SUPER_HERO">SUPER HERO</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="isAdmin"
          checked={formData.isAdmin}
          onCheckedChange={(checked) => setFormData({ ...formData, isAdmin: checked })}
        />
        <Label htmlFor="isAdmin" className="text-black">Admin privileges</Label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading} className="bg-marvel-red hover:bg-red-700">
          Update User
        </Button>
      </div>
    </form>
  );
}