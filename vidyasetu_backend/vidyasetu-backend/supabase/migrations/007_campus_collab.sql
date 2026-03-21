-- ==============================================================================
-- Sector 6: Campus Collab (IRL Connect)
-- Facilitates hyper-local error fixing / peer programming in exchange for IRL treats.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.campus_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    helper_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    college_id TEXT NOT NULL, -- Cached from creator's profile at creation time for easy RLS
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    error_snippet TEXT,
    location_hint TEXT NOT NULL, -- e.g., 'Library, 2nd Floor', 'Cafe Starbucks'
    treat_type TEXT NOT NULL CHECK (treat_type IN ('coffee', 'tea', 'snack', 'lunch', 'other')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast local querying
CREATE INDEX IF NOT EXISTS idx_campus_requests_college ON public.campus_requests(college_id, status);

-- Enable RLS
ALTER TABLE public.campus_requests ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- RLS POLICIES
-- 1. Users can view any requests that match their own college string.
-- 2. Users can create requests, stamping their own college string.
-- 3. Users can update requests if they are the creator OR the assigned helper.
-- ------------------------------------------------------------------------------

-- RLS: Read
CREATE POLICY "Users can read campus requests for their college"
    ON public.campus_requests FOR SELECT
    USING (
        college_id = (SELECT college FROM public.users WHERE id = auth.uid()) OR
        creator_id = auth.uid() OR
        helper_id = auth.uid()
    );

-- RLS: Insert
CREATE POLICY "Users can create campus requests"
    ON public.campus_requests FOR INSERT
    WITH CHECK (
        creator_id = auth.uid() AND
        college_id = (SELECT college FROM public.users WHERE id = auth.uid())
    );

-- RLS: Update
CREATE POLICY "Creators and Helpers can update campus requests"
    ON public.campus_requests FOR UPDATE
    USING (
        creator_id = auth.uid() OR 
        helper_id = auth.uid() OR 
        -- Allow someone to accept an open request if they are in the same college
        (status = 'open' AND college_id = (SELECT college FROM public.users WHERE id = auth.uid()))
    );

-- ------------------------------------------------------------------------------
-- ADD TO NAVIGATION (Optional seed for any dynamic nav loading)
-- ------------------------------------------------------------------------------
-- No data changes needed for pure schema.
