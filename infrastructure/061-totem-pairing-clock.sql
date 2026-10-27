-- 059 let the pairing row take created_at from its default and computed
-- expires_at from a second clock_timestamp(); PostgreSQL may evaluate the default
-- after the value, which intermittently violated gate_totem_pairings_window_ck.
-- Redefines only that function, with the same signature, owner and grant.
CREATE OR REPLACE FUNCTION app_gate_totem_pairing_create(target_gate_id uuid,candidate bytea)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor text; target gates%ROWTYPE; pairing gate_totem_pairings%ROWTYPE; issued timestamptz;
BEGIN
 actor:=app_current_user_id();
 IF candidate IS NULL OR octet_length(candidate)<>32 THEN RAISE EXCEPTION 'Código de pareamento inválido' USING ERRCODE='22023'; END IF;
 SELECT * INTO target FROM gates WHERE id=target_gate_id;
 IF actor IS NULL OR NOT FOUND OR NOT (app_access_has_capability(target.building_id,target.id::text,'gates:read')
   AND app_access_has_capability(target.building_id,target.id::text,'gates:manage')) THEN
   RAISE EXCEPTION 'Sem permissão atual para configurar este acesso' USING ERRCODE='42501';
 END IF;
 IF NOT app_gate_qr_enabled(target.building_id,target.kind) THEN
   RAISE EXCEPTION 'Abertura por QR indisponível neste condomínio' USING ERRCODE='PF001';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('access:totem-pairing:' || target.id::text,0));
 DELETE FROM gate_totem_pairings WHERE gate_id=target.id AND used_at IS NULL;
 -- One instant for both columns: two clock_timestamp() calls in one row may come
 -- in either order and break the 10-minute CHECK by microseconds.
 issued:=clock_timestamp();
 INSERT INTO gate_totem_pairings(gate_id,building_id,code_hash,created_by,created_at,expires_at)
 VALUES(target.id,target.building_id,candidate,actor,issued,issued+interval '10 minutes') RETURNING * INTO pairing;
 INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
 VALUES(target.building_id,actor,'USER','ACCESS_TOTEM_PAIRING_CREATED','gate',target.id::text,
   jsonb_build_object('pairingId',pairing.id,'expiresAt',pairing.expires_at));
 RETURN pairing.expires_at;
END $$;

DO $$ DECLARE helper_owner text; helper regprocedure:='app_gate_totem_pairing_create(uuid,bytea)'::regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
 FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
   JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
END $$;
