import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { apiRequest } from '@/lib/queryClient';
import { Clock, Play, Pause, Settings, Calendar, AlertCircle } from 'lucide-react';

interface SchedulerConfig {
  enabled: boolean;
  dailyImageUpdates: {
    enabled: boolean;
    schedule: string;
    batchSize: number;
    maxPerDay: number;
  };
  weeklyMaintenance: {
    enabled: boolean;
    schedule: string;
    batchSize: number;
  };
}

interface SchedulerStatus {
  enabled: boolean;
  activeJobs: string[];
  dailyProcessedCount: number;
  lastResetDate: string;
  config: SchedulerConfig;
}

export default function SchedulerManager() {
  const [editMode, setEditMode] = useState(false);
  const [localConfig, setLocalConfig] = useState<SchedulerConfig | null>(null);
  const { toast } = useToast();

  // Fetch scheduler status
  const { data: status, isLoading, refetch } = useQuery<SchedulerStatus>({
    queryKey: ['/api/admin/scheduler/status'],
    queryFn: () => apiRequest('GET', '/api/admin/scheduler/status').then(res => res.json()),
  });

  // Update scheduler config
  const updateConfig = useMutation({
    mutationFn: (config: Partial<SchedulerConfig>) => 
      apiRequest('POST', '/api/admin/scheduler/config', config).then(res => res.json()),
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Scheduler configuration updated successfully",
      });
      setEditMode(false);
      setLocalConfig(null);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scheduler/status'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update scheduler configuration",
        variant: "destructive",
      });
    }
  });

  // Stop all jobs
  const stopJobs = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/scheduler/stop').then(res => res.json()),
    onSuccess: () => {
      toast({
        title: "Success",
        description: "All scheduled jobs stopped",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scheduler/status'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to stop scheduler",
        variant: "destructive",
      });
    }
  });

  const handleEditConfig = () => {
    if (status) {
      setLocalConfig({ ...status.config });
      setEditMode(true);
    }
  };

  const handleSaveConfig = () => {
    if (localConfig) {
      updateConfig.mutate(localConfig);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setLocalConfig(null);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Background Scheduler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Background Scheduler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load scheduler status. Please check your connection and try again.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const config = editMode ? localConfig : status.config;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Background Scheduler
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={status.enabled ? "default" : "secondary"}>
              {status.enabled ? "Active" : "Inactive"}
            </Badge>
            {!editMode && (
              <Button
                onClick={handleEditConfig}
                variant="outline"
                size="sm"
                className="flex items-center gap-1"
              >
                <Settings className="h-3 w-3" />
                Configure
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Active Jobs</Label>
            <div className="flex flex-wrap gap-1">
              {status.activeJobs.length > 0 ? (
                status.activeJobs.map((job) => (
                  <Badge key={job} variant="outline" className="text-xs">
                    {job}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-gray-500">None running</span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-medium">Daily Progress</Label>
            <div className="text-sm">
              <span className="font-mono">{status.dailyProcessedCount}</span> cards processed today
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-medium">Last Reset</Label>
            <div className="text-sm text-gray-600">
              {status.lastResetDate}
            </div>
          </div>
        </div>

        <Separator />

        {/* Configuration */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Configuration</h3>
            {editMode && (
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleCancelEdit}
                  variant="outline"
                  size="sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveConfig}
                  size="sm"
                  disabled={updateConfig.isPending}
                >
                  {updateConfig.isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            )}
          </div>

          {/* Global Enable/Disable */}
          <div className="flex items-center space-x-2">
            <Switch
              id="scheduler-enabled"
              checked={config?.enabled || false}
              onCheckedChange={(checked) => {
                if (editMode && localConfig) {
                  setLocalConfig({ ...localConfig, enabled: checked });
                }
              }}
              disabled={!editMode}
            />
            <Label htmlFor="scheduler-enabled" className="text-sm font-medium">
              Enable Background Scheduler
            </Label>
          </div>

          {/* Daily Image Updates */}
          <Card className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Daily Image Updates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="daily-enabled"
                  checked={config?.dailyImageUpdates?.enabled || false}
                  onCheckedChange={(checked) => {
                    if (editMode && localConfig) {
                      setLocalConfig({
                        ...localConfig,
                        dailyImageUpdates: { ...localConfig.dailyImageUpdates, enabled: checked }
                      });
                    }
                  }}
                  disabled={!editMode}
                />
                <Label htmlFor="daily-enabled" className="text-sm">
                  Enable daily processing
                </Label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="daily-schedule" className="text-sm">Schedule (Cron)</Label>
                  <Input
                    id="daily-schedule"
                    value={config?.dailyImageUpdates?.schedule || ''}
                    onChange={(e) => {
                      if (editMode && localConfig) {
                        setLocalConfig({
                          ...localConfig,
                          dailyImageUpdates: { ...localConfig.dailyImageUpdates, schedule: e.target.value }
                        });
                      }
                    }}
                    disabled={!editMode}
                    placeholder="0 2 * * *"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="daily-batch-size" className="text-sm">Batch Size</Label>
                  <Input
                    id="daily-batch-size"
                    type="number"
                    value={config?.dailyImageUpdates?.batchSize || 0}
                    onChange={(e) => {
                      if (editMode && localConfig) {
                        setLocalConfig({
                          ...localConfig,
                          dailyImageUpdates: { ...localConfig.dailyImageUpdates, batchSize: parseInt(e.target.value) }
                        });
                      }
                    }}
                    disabled={!editMode}
                    min="1"
                    max="5000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="daily-max-per-day" className="text-sm">Max Per Day</Label>
                  <Input
                    id="daily-max-per-day"
                    type="number"
                    value={config?.dailyImageUpdates?.maxPerDay || 0}
                    onChange={(e) => {
                      if (editMode && localConfig) {
                        setLocalConfig({
                          ...localConfig,
                          dailyImageUpdates: { ...localConfig.dailyImageUpdates, maxPerDay: parseInt(e.target.value) }
                        });
                      }
                    }}
                    disabled={!editMode}
                    min="100"
                    max="10000"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Weekly Maintenance */}
          <Card className="border-l-4 border-l-green-500">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Weekly Maintenance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="weekly-enabled"
                  checked={config?.weeklyMaintenance?.enabled || false}
                  onCheckedChange={(checked) => {
                    if (editMode && localConfig) {
                      setLocalConfig({
                        ...localConfig,
                        weeklyMaintenance: { ...localConfig.weeklyMaintenance, enabled: checked }
                      });
                    }
                  }}
                  disabled={!editMode}
                />
                <Label htmlFor="weekly-enabled" className="text-sm">
                  Enable weekly maintenance
                </Label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="weekly-schedule" className="text-sm">Schedule (Cron)</Label>
                  <Input
                    id="weekly-schedule"
                    value={config?.weeklyMaintenance?.schedule || ''}
                    onChange={(e) => {
                      if (editMode && localConfig) {
                        setLocalConfig({
                          ...localConfig,
                          weeklyMaintenance: { ...localConfig.weeklyMaintenance, schedule: e.target.value }
                        });
                      }
                    }}
                    disabled={!editMode}
                    placeholder="0 3 * * 0"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="weekly-batch-size" className="text-sm">Batch Size</Label>
                  <Input
                    id="weekly-batch-size"
                    type="number"
                    value={config?.weeklyMaintenance?.batchSize || 0}
                    onChange={(e) => {
                      if (editMode && localConfig) {
                        setLocalConfig({
                          ...localConfig,
                          weeklyMaintenance: { ...localConfig.weeklyMaintenance, batchSize: parseInt(e.target.value) }
                        });
                      }
                    }}
                    disabled={!editMode}
                    min="1"
                    max="2000"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Control Actions */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-gray-600 dark:text-gray-300">
            Schedule format: minute hour day month day-of-week
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => refetch()}
              variant="outline"
              size="sm"
              className="border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
            >
              Refresh
            </Button>
            <Button
              onClick={() => stopJobs.mutate()}
              variant="destructive"
              size="sm"
              disabled={stopJobs.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {stopJobs.isPending ? 'Stopping...' : 'Stop All'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}