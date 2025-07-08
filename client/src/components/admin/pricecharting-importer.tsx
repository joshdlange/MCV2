import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { CheckCircle, XCircle, Clock, AlertCircle, Download, Database, Zap } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface PriceChartingConfig {
  ready: boolean;
  missingConfig: string[];
  hasToken: boolean;
  hasCloudinary: boolean;
}

interface ImportResult {
  setsProcessed: number;
  setsInserted: number;
  setsSkipped: number;
  cardsProcessed: number;
  cardsInserted: number;
  cardsSkipped: number;
  errors: string[];
  skippedItems: Array<{
    type: 'set' | 'card';
    name: string;
    reason: string;
  }>;
}

export function PriceChartingImporter() {
  const [config, setConfig] = useState<PriceChartingConfig | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [limit, setLimit] = useState(25);
  const [rateLimitMs, setRateLimitMs] = useState(2000);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    checkConfig();
  }, []);

  const checkConfig = async () => {
    try {
      const response = await apiRequest('GET', '/api/admin/pricecharting-config');
      const data = await response.json();
      setConfig(data);
    } catch (error) {
      console.error('Failed to check PriceCharting config:', error);
      toast({
        title: "Configuration Error",
        description: "Failed to check PriceCharting configuration",
        variant: "destructive",
      });
    }
  };

  const startImport = async () => {
    if (!config?.ready) {
      toast({
        title: "Configuration Error",
        description: "PriceCharting configuration is not ready",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    setImportResult(null);
    setProgress(0);

    try {
      const response = await apiRequest('POST', '/api/admin/import-pricecharting', {
        limit,
        rateLimitMs
      });
      
      const data = await response.json();
      setImportResult(data.result);
      setProgress(100);
      
      toast({
        title: "Import Complete",
        description: `Successfully imported ${data.result.cardsInserted} cards from ${data.result.setsInserted} sets`,
        variant: "default",
      });

    } catch (error: any) {
      console.error('Import failed:', error);
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import PriceCharting data",
        variant: "destructive",
      });
      setImportResult({
        setsProcessed: 0,
        setsInserted: 0,
        setsSkipped: 0,
        cardsProcessed: 0,
        cardsInserted: 0,
        cardsSkipped: 0,
        errors: [error.message || "Unknown error occurred"],
        skippedItems: []
      });
    } finally {
      setIsImporting(false);
    }
  };

  const getStatusIcon = (ready: boolean) => {
    return ready ? (
      <CheckCircle className="h-4 w-4 text-green-500" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500" />
    );
  };

  const getStatusColor = (ready: boolean) => {
    return ready ? 'default' : 'destructive';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Download className="h-5 w-5 text-blue-500" />
        <h2 className="text-lg font-semibold">PriceCharting Importer</h2>
      </div>

      {/* Configuration Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Configuration Status
          </CardTitle>
          <CardDescription>
            Check API credentials and system readiness
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {config ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  {getStatusIcon(config.ready)}
                  <span className="text-sm">Overall Status</span>
                  <Badge variant={getStatusColor(config.ready)}>
                    {config.ready ? 'Ready' : 'Not Ready'}
                  </Badge>
                </div>
                
                <div className="flex items-center gap-2">
                  {getStatusIcon(config.hasToken)}
                  <span className="text-sm">API Token</span>
                  <Badge variant={getStatusColor(config.hasToken)}>
                    {config.hasToken ? 'Configured' : 'Missing'}
                  </Badge>
                </div>
                
                <div className="flex items-center gap-2">
                  {getStatusIcon(config.hasCloudinary)}
                  <span className="text-sm">Cloudinary</span>
                  <Badge variant={getStatusColor(config.hasCloudinary)}>
                    {config.hasCloudinary ? 'Configured' : 'Missing'}
                  </Badge>
                </div>
              </div>
              
              {config.missingConfig.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Missing configuration: {config.missingConfig.join(', ')}
                  </AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-gray-500">
              <Clock className="h-4 w-4" />
              <span>Loading configuration...</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Import Settings
          </CardTitle>
          <CardDescription>
            Configure the import process parameters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="limit">Card Limit</Label>
              <Input
                id="limit"
                type="number"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                min="1"
                max="1000"
                disabled={isImporting}
              />
              <p className="text-xs text-gray-500">Maximum cards to process per run</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="rateLimit">Rate Limit (ms)</Label>
              <Input
                id="rateLimit"
                type="number"
                value={rateLimitMs}
                onChange={(e) => setRateLimitMs(Number(e.target.value))}
                min="1000"
                max="10000"
                disabled={isImporting}
              />
              <p className="text-xs text-gray-500">Delay between API requests</p>
            </div>
          </div>

          <Button 
            onClick={startImport}
            disabled={!config?.ready || isImporting}
            className="w-full"
          >
            {isImporting ? (
              <>
                <Clock className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Start Import
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Progress */}
      {isImporting && (
        <Card>
          <CardHeader>
            <CardTitle>Import Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="w-full" />
            <p className="text-sm text-gray-500 mt-2">
              Processing PriceCharting data...
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Import Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Sets</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Processed:</span>
                    <span className="font-medium">{importResult.setsProcessed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Inserted:</span>
                    <span className="font-medium text-green-600">{importResult.setsInserted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Skipped:</span>
                    <span className="font-medium text-yellow-600">{importResult.setsSkipped}</span>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Cards</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Processed:</span>
                    <span className="font-medium">{importResult.cardsProcessed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Inserted:</span>
                    <span className="font-medium text-green-600">{importResult.cardsInserted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Skipped:</span>
                    <span className="font-medium text-yellow-600">{importResult.cardsSkipped}</span>
                  </div>
                </div>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm text-red-600">Errors</h4>
                  <div className="space-y-1">
                    {importResult.errors.map((error, index) => (
                      <Alert key={index} variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-xs">{error}</AlertDescription>
                      </Alert>
                    ))}
                  </div>
                </div>
              </>
            )}

            {importResult.skippedItems.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm text-yellow-600">Skipped Items</h4>
                  <div className="max-h-32 overflow-y-auto">
                    {importResult.skippedItems.slice(0, 10).map((item, index) => (
                      <div key={index} className="text-xs text-gray-600 flex justify-between">
                        <span>{item.name}</span>
                        <span className="text-yellow-600">{item.reason}</span>
                      </div>
                    ))}
                    {importResult.skippedItems.length > 10 && (
                      <div className="text-xs text-gray-500">
                        ... and {importResult.skippedItems.length - 10} more items
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}