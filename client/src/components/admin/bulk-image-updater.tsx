import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Image, Database } from 'lucide-react';

interface MissingImagesInfo {
  count: number;
  configReady: boolean;
  missingConfig: string[];
  rateLimitMs: number;
  sampleCards: Array<{
    id: number;
    name: string;
    setName: string;
    cardNumber: string;
  }>;
}

interface BulkUpdateProgress {
  type: 'progress' | 'complete';
  current: number;
  total: number;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  cardId?: number;
  cardName?: string;
  status?: 'processing' | 'success' | 'failure' | 'skipped';
  message?: string;
  successes?: Array<{
    cardId: number;
    cardName: string;
    setName: string;
    newImageUrl: string;
  }>;
  failures?: Array<{
    cardId: number;
    cardName: string;
    setName: string;
    error: string;
  }>;
}

export default function BulkImageUpdater() {
  const [missingInfo, setMissingInfo] = useState<MissingImagesInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState<BulkUpdateProgress | null>(null);
  const [limit, setLimit] = useState('50');
  const [rateLimitMs, setRateLimitMs] = useState('1000');
  const [logs, setLogs] = useState<string[]>([]);
  const { toast } = useToast();

  const fetchMissingInfo = async () => {
    setLoading(true);
    try {
      const response = await apiRequest('GET', '/api/admin/missing-images-count');
      const data = await response.json();
      setMissingInfo(data);
    } catch (error) {
      console.error('Error fetching missing images info:', error);
      toast({
        title: "Error",
        description: "Failed to load missing images information",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const startBulkUpdate = async () => {
    if (!missingInfo?.configReady) {
      toast({
        title: "Configuration Error",
        description: "Missing required configuration. Please check environment variables.",
        variant: "destructive",
      });
      return;
    }

    setUpdating(true);
    setProgress(null);
    setLogs([]);

    try {
      const response = await fetch('/api/admin/update-missing-images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await (window as any).firebase.auth().currentUser?.getIdToken()}`
        },
        body: JSON.stringify({
          limit: parseInt(limit),
          rateLimitMs: parseInt(rateLimitMs)
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              setProgress(data);
              
              if (data.type === 'progress') {
                const statusEmoji = {
                  processing: '⏳',
                  success: '✅',
                  failure: '❌',
                  skipped: '⏭️'
                }[data.status as keyof typeof statusEmoji] || '⏳';
                
                const logEntry = `${statusEmoji} [${Math.round((data.current / data.total) * 100)}%] ${data.current}/${data.total} - Card ${data.cardId}: ${data.cardName}`;
                setLogs(prev => [...prev.slice(-20), logEntry]); // Keep last 20 logs
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      toast({
        title: "Bulk Update Complete",
        description: "Image update process finished successfully",
      });
    } catch (error) {
      console.error('Bulk update error:', error);
      toast({
        title: "Error",
        description: "Failed to perform bulk image update",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
      await fetchMissingInfo(); // Refresh the count
    }
  };

  useEffect(() => {
    fetchMissingInfo();
  }, []);

  const progressPercentage = progress?.total ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            Bulk Image Updater
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Missing Images</Label>
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-2xl font-bold">
                  {loading ? '...' : missingInfo?.count || 0}
                </span>
                <span className="text-sm text-muted-foreground">cards</span>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">Configuration Status</Label>
              <div className="flex items-center gap-2">
                {loading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : missingInfo?.configReady ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <Badge variant={missingInfo?.configReady ? "default" : "destructive"}>
                  {loading ? 'Checking...' : missingInfo?.configReady ? 'Ready' : 'Error'}
                </Badge>
              </div>
            </div>
          </div>

          {/* Configuration Issues */}
          {missingInfo && !missingInfo.configReady && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Missing configuration: {missingInfo.missingConfig?.join(', ') || 'Unknown configuration error'}
              </AlertDescription>
            </Alert>
          )}

          {/* Sample Cards */}
          {missingInfo?.sampleCards && missingInfo.sampleCards.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Sample Cards Missing Images</Label>
              <div className="text-sm text-muted-foreground space-y-1">
                {missingInfo.sampleCards.map((card) => (
                  <div key={card.id} className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                      {card.id}
                    </span>
                    <span>{card.setName} - {card.name} #{card.cardNumber}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Update Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="limit">Limit (max cards to process)</Label>
              <Input
                id="limit"
                type="number"
                min="1"
                max="1000"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                disabled={updating}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="rateLimitMs">Rate Limit (ms between requests)</Label>
              <Input
                id="rateLimitMs"
                type="number"
                min="500"
                max="5000"
                value={rateLimitMs}
                onChange={(e) => setRateLimitMs(e.target.value)}
                disabled={updating}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={startBulkUpdate}
              disabled={updating || !missingInfo?.configReady || (missingInfo?.count || 0) === 0}
              className="flex-1"
            >
              {updating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <Image className="h-4 w-4 mr-2" />
                  Start Bulk Update
                </>
              )}
            </Button>
            
            <Button
              variant="outline"
              onClick={fetchMissingInfo}
              disabled={loading || updating}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Progress */}
          {progress && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{progress.current}/{progress.total} ({progressPercentage}%)</span>
                </div>
                <Progress value={progressPercentage} className="h-2" />
              </div>
              
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-green-600 font-semibold">{progress.successCount}</div>
                  <div className="text-muted-foreground">Success</div>
                </div>
                <div className="text-center">
                  <div className="text-red-600 font-semibold">{progress.failureCount}</div>
                  <div className="text-muted-foreground">Failed</div>
                </div>
                <div className="text-center">
                  <div className="text-blue-600 font-semibold">{progress.totalProcessed}</div>
                  <div className="text-muted-foreground">Total</div>
                </div>
              </div>
            </div>
          )}

          {/* Live Logs */}
          {logs.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Live Progress</Label>
              <div className="bg-muted rounded-md p-3 max-h-40 overflow-y-auto">
                <pre className="text-xs whitespace-pre-wrap">
                  {logs.slice(-10).join('\n')}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}