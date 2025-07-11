import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { CheckCircle, XCircle, Clock, AlertCircle, Play, Square, Database } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface ImportProgress {
  isRunning: boolean;
  currentSetIndex: number;
  totalSets: number;
  totalCardsAdded: number;
  totalSetsProcessed: number;
  currentSetName: string;
  lastUpdated: string;
  errors: string[];
}

export function BackgroundPriceChartingImporter() {
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 3000); // Check every 3 seconds
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      const response = await apiRequest('/api/admin/pricecharting-import/status');
      setImportProgress(response);
    } catch (error) {
      console.error('Failed to check import status:', error);
    }
  };

  const startImport = async () => {
    try {
      await apiRequest('/api/admin/pricecharting-import/start', {
        method: 'POST',
      });
      toast({
        title: "Import Started",
        description: "PriceCharting import has been started in the background",
        variant: "default",
      });
    } catch (error) {
      console.error('Failed to start import:', error);
      toast({
        title: "Import Failed",
        description: "Failed to start PriceCharting import",
        variant: "destructive",
      });
    }
  };

  const stopImport = async () => {
    try {
      await apiRequest('/api/admin/pricecharting-import/stop', {
        method: 'POST',
      });
      toast({
        title: "Import Stopped",
        description: "PriceCharting import has been stopped",
        variant: "default",
      });
    } catch (error) {
      console.error('Failed to stop import:', error);
      toast({
        title: "Stop Failed",
        description: "Failed to stop PriceCharting import",
        variant: "destructive",
      });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const calculateProgress = () => {
    if (!importProgress || importProgress.totalSets === 0) return 0;
    return Math.round((importProgress.currentSetIndex / importProgress.totalSets) * 100);
  };

  const getStatusBadge = () => {
    if (!importProgress) return <Badge variant="outline">Unknown</Badge>;
    
    if (importProgress.isRunning) {
      return <Badge variant="default" className="bg-blue-600"><Clock className="w-3 h-3 mr-1" />Running</Badge>;
    } else if (importProgress.currentSetIndex >= importProgress.totalSets) {
      return <Badge variant="default" className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />Complete</Badge>;
    } else {
      return <Badge variant="outline"><Square className="w-3 h-3 mr-1" />Stopped</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Background PriceCharting Import
          </CardTitle>
          <CardDescription>
            Continuously imports missing cards from PriceCharting across all 1,114 card sets
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {getStatusBadge()}
              {importProgress && (
                <span className="text-sm text-muted-foreground">
                  Last updated: {formatDate(importProgress.lastUpdated)}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={startImport}
                disabled={importProgress?.isRunning}
                size="sm"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Import
              </Button>
              <Button
                onClick={stopImport}
                disabled={!importProgress?.isRunning}
                variant="outline"
                size="sm"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop Import
              </Button>
            </div>
          </div>

          {importProgress && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{calculateProgress()}%</span>
                </div>
                <Progress value={calculateProgress()} className="h-2" />
                <div className="text-xs text-muted-foreground">
                  {importProgress.currentSetIndex} of {importProgress.totalSets} sets processed
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Cards Added</div>
                  <div className="text-2xl font-bold text-green-600">
                    {importProgress.totalCardsAdded.toLocaleString()}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium">Sets Processed</div>
                  <div className="text-2xl font-bold text-blue-600">
                    {importProgress.totalSetsProcessed.toLocaleString()}
                  </div>
                </div>
              </div>

              {importProgress.currentSetName && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Currently Processing</div>
                  <div className="text-sm text-muted-foreground bg-muted p-2 rounded">
                    {importProgress.currentSetName}
                  </div>
                </div>
              )}

              {importProgress.errors.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      <div className="font-medium">Recent Errors ({importProgress.errors.length})</div>
                      {importProgress.errors.slice(-3).map((error, index) => (
                        <div key={index} className="text-xs text-red-600">
                          {error}
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm">Runs continuously in the background</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm">Only adds cards that don't already exist</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm">Processes all 1,114 card sets automatically</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm">Respects API rate limits (2 second delays)</span>
            </div>
          </div>
          
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This import can run for several hours to complete all 1,114 sets. 
              You can safely close this page and return later to check progress.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

export default BackgroundPriceChartingImporter;